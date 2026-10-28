-- =====================================================================
-- ZPro Condominio · 0020 Enlace de invitación del condominio
--
-- La app de administración comparte UN enlace (por WhatsApp, QR impreso en la cartelera…)
-- para que cada vecino descargue la app de miembros y pida entrar: elige su casa y la junta
-- aprueba. Así la junta trae a "sus" usuarios sin repartir un código por casa.
-- El enlace dura un año, admite muchos usos y se puede regenerar (el anterior deja de servir).
-- =====================================================================

-- Un código general (sin casa) para residentes es válido si SIEMPRE requiere aprobación.
do $$
declare n text;
begin
  for n in select conname from pg_constraint
            where conrelid = 'public.codigos_acceso'::regclass and contype = 'c'
              and pg_get_constraintdef(oid) like '%unidad_id IS NOT NULL%' loop
    execute format('alter table public.codigos_acceso drop constraint %I', n);
  end loop;
end $$;
alter table codigos_acceso add column es_enlace boolean not null default false;
alter table codigos_acceso add constraint codigos_acceso_rol_unidad check (
  rol in ('presidente','tesorero','vocal','administrador') or unidad_id is not null or (es_enlace and requiere_aprobacion));

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso'));

create or replace function codigo_legible(n integer) returns text
language sql volatile as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '') from generate_series(1, n);
$$;

-- Enlace vigente (lo crea si no hay). Solo presidencia o la administración.
create or replace function enlace_invitacion(p_condominio uuid, p_regenerar boolean default false)
returns codigos_acceso language plpgsql security definer set search_path = public as $$
declare k codigos_acceso; i integer := 0;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración comparte el enlace de invitación';
  end if;
  if p_regenerar then
    update codigos_acceso set expira_en = now() where condominio_id = p_condominio and es_enlace and expira_en > now();
  end if;
  select * into k from codigos_acceso where condominio_id = p_condominio and es_enlace and expira_en > now() and usos < usos_max
   order by expira_en desc limit 1;
  if k.codigo is not null then return k; end if;
  loop
    i := i + 1;
    begin
      insert into codigos_acceso (codigo, condominio_id, unidad_id, rol, usos_max, expira_en, requiere_aprobacion, creado_por, es_enlace)
      values ('INV-' || codigo_legible(6), p_condominio, null, 'propietario', 5000, now() + interval '1 year', true, auth.uid(), true)
      returning * into k;
      return k;
    exception when unique_violation then
      if i > 5 then raise; end if;
    end;
  end loop;
end $$;

-- Datos públicos de una invitación (cualquiera con el enlace): nombre del condominio y la lista de casas
-- (solo la etiqueta: "Casa 28"; nunca nombres ni teléfonos).
create or replace function info_invitacion(p_codigo text)
returns table (condominio_id uuid, condominio text, ciudad text, unidades jsonb)
language plpgsql stable security definer set search_path = public as $$
declare k codigos_acceso;
begin
  select * into k from codigos_acceso where codigo = upper(trim(p_codigo)) and es_enlace;
  if k.codigo is null or k.expira_en < now() or k.usos >= k.usos_max or not condominio_operativo(k.condominio_id) then
    raise exception 'Enlace inválido o vencido. Pida uno nuevo a su junta de condominio';
  end if;
  return query
    select c.id, c.nombre, c.ciudad,
           coalesce((select jsonb_agg(jsonb_build_object('id', u.id, 'etiqueta', etiqueta_unidad(u)) order by u.bloque nulls first, u.numero)
                       from unidades u where u.condominio_id = c.id), '[]')
      from condominios c where c.id = k.condominio_id;
end $$;
grant execute on function info_invitacion(text) to anon;

-- Pedir entrar con el enlace: la persona elige su casa; queda pendiente hasta que la junta apruebe.
create or replace function unirse_con_enlace(p_codigo text, p_unidad uuid, p_rol rol_condominio)
returns text language plpgsql security definer set search_path = public as $$
declare k codigos_acceso;
begin
  if auth.uid() is null then raise exception 'Inicie sesión'; end if;
  if p_rol not in ('propietario', 'inquilino') then raise exception 'Rol inválido'; end if;
  select * into k from codigos_acceso where codigo = upper(trim(p_codigo)) and es_enlace for update;
  if k.codigo is null or k.expira_en < now() or k.usos >= k.usos_max then
    raise exception 'Enlace inválido o vencido. Pida uno nuevo a su junta de condominio';
  end if;
  if not condominio_operativo(k.condominio_id) then raise exception 'Este condominio no está habilitado'; end if;
  if not exists (select 1 from unidades where id = p_unidad and condominio_id = k.condominio_id) then
    raise exception 'Esa casa no pertenece a este condominio';
  end if;
  if exists (select 1 from membresias where condominio_id = k.condominio_id and usuario_id = auth.uid() and unidad_id = p_unidad and activo) then
    return 'aprobada';
  end if;
  if exists (select 1 from solicitudes_ingreso where condominio_id = k.condominio_id and usuario_id = auth.uid() and estado = 'pendiente') then
    return 'pendiente';
  end if;
  update codigos_acceso set usos = usos + 1 where codigo = k.codigo;
  insert into solicitudes_ingreso (condominio_id, usuario_id, unidad_id, rol)
  values (k.condominio_id, auth.uid(), p_unidad, p_rol) on conflict do nothing;
  return 'pendiente';
end $$;

-- La junta se entera de cada solicitud de ingreso nueva (por enlace o por código).
create or replace function notificar_solicitud() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_casa text; v_nombre text;
begin
  select etiqueta_unidad(u) into v_casa from unidades u where u.id = new.unidad_id;
  select nombre into v_nombre from perfiles where id = new.usuario_id;
  perform notificar(array(select distinct usuario_id from membresias where condominio_id = new.condominio_id and activo
                            and rol in ('presidente', 'administrador')),
    new.condominio_id, 'solicitud_ingreso', 'Solicitud de ingreso' || coalesce(': ' || v_casa, ''),
    coalesce(v_nombre, 'Una persona') || ' pide entrar al condominio' || coalesce(' como residente de ' || v_casa, '')
      || '. Verifique que sea de esa casa antes de aprobar.',
    jsonb_build_object('pantalla', 'accesos'));
  return null;
end $$;
create trigger solicitudes_notificar after insert on solicitudes_ingreso
  for each row execute function notificar_solicitud();
