-- ============================================================================
-- ZPro Condominio · 0027 Datos para pagar
-- La junta (presidencia, tesorería o administración) carga los datos de cada cuenta del condominio por campos:
-- banco (código de 4 dígitos), titular, cédula o RIF, teléfono de Pago Móvil, número de cuenta (20 dígitos),
-- correo (Zelle) y, opcional, la imagen del QR de cobro que genera la app de su banco.
-- La app del vecino arma con eso el QR con los datos del pago y los botones "Copiar".
-- Contra el fraude: cada cambio avisa a toda la junta (quién lo hizo y qué cambió) y queda la fecha del cambio.
-- ============================================================================

alter table cuentas_financieras
  add column banco_codigo text check (banco_codigo ~ '^\d{4}$'),
  add column titular text check (char_length(titular) between 2 and 120),
  add column documento text check (documento ~ '^[VEJGP]\d{5,10}$'),       -- letra + números, sin guiones
  add column telefono text check (telefono ~ '^04\d{9}$'),                  -- 11 dígitos: 04141234567
  add column numero_cuenta text check (numero_cuenta ~ '^\d{20}$'),
  add column correo text check (char_length(correo) <= 200),
  add column qr_path text,                                                  -- imagen del QR del banco (bucket marca)
  add column datos_actualizados_en timestamptz,
  add column datos_actualizados_por uuid references perfiles(id) on delete set null,
  add constraint cuenta_banco_coincide check (numero_cuenta is null or banco_codigo is null or left(numero_cuenta, 4) = banco_codigo);

-- La imagen del QR la sube quien maneja las finanzas, en <condominio>/cobro/…
create policy marca_cobro_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'marca' and (storage.foldername(name))[2] = 'cobro'
  and maneja_finanzas(((storage.foldername(name))[1])::uuid));

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso', 'difusion', 'cierre_mes', 'tasa_bcv', 'mensaje_anonimo', 'denuncia_anonima',
  'datos_pago'));

-- Al cambiar los datos que usan los vecinos para pagar: se sella la fecha y se avisa a TODA la junta.
create or replace function cuentas_datos_pago_cambio() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  quien text := coalesce((select nombre from perfiles where id = auth.uid()), 'Alguien de la junta');
  cambios text[] := '{}';
begin
  if tg_op = 'UPDATE' then
    if new.banco_codigo is distinct from old.banco_codigo then cambios := array_append(cambios, 'banco'::text); end if;
    if new.titular is distinct from old.titular then cambios := array_append(cambios, 'titular'::text); end if;
    if new.documento is distinct from old.documento then cambios := array_append(cambios, 'cédula o RIF'::text); end if;
    if new.telefono is distinct from old.telefono then cambios := array_append(cambios, 'teléfono de Pago Móvil'::text); end if;
    if new.numero_cuenta is distinct from old.numero_cuenta then cambios := array_append(cambios, 'número de cuenta'::text); end if;
    if new.correo is distinct from old.correo then cambios := array_append(cambios, 'correo'::text); end if;
    if new.qr_path is distinct from old.qr_path then cambios := array_append(cambios, 'QR del banco'::text); end if;
    if new.datos_pago is distinct from old.datos_pago then cambios := array_append(cambios, 'nota'::text); end if;
    if new.activa is distinct from old.activa then cambios := array_append(cambios, case when new.activa then 'reactivada' else 'desactivada' end); end if;
  elsif new.banco_codigo is not null or new.telefono is not null or new.numero_cuenta is not null or new.correo is not null then
    cambios := array['cuenta nueva'];
  end if;
  if cardinality(cambios) = 0 then return new; end if;
  new.datos_actualizados_en := now();
  new.datos_actualizados_por := auth.uid();
  perform notificar(array_remove(usuarios_junta(new.condominio_id), auth.uid()), new.condominio_id, 'datos_pago',
    'Cambiaron los datos para pagar',
    format('%s cambió "%s": %s. Revise que sean correctos: son los que usan los vecinos para pagar.',
           quien, new.nombre, array_to_string(cambios, ', ')),
    jsonb_build_object('pantalla', 'datos-pago', 'cuentaId', new.id));
  return new;
end $$;

create trigger cuentas_datos_pago_cambio before insert or update on cuentas_financieras
  for each row execute function cuentas_datos_pago_cambio();
