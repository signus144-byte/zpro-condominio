-- =====================================================================
-- ZPro Condominio · 0006 Documentos con la marca del condominio
-- Estados de cuenta, recibos, solvencias, relación de gastos, actas de
-- votación (para firma y sello), convocatorias. Formatos: PDF y Excel (.xlsx,
-- se abre gratis en Google Sheets, LibreOffice o Excel).
-- Cada documento lleva un código y un QR para verificar que es auténtico.
-- =====================================================================

create type tipo_documento as enum (
  'estado_cuenta', 'recibo', 'solvencia', 'relacion_gastos', 'acta_votacion',
  'convocatoria', 'morosidad', 'libro_ingresos_egresos', 'circular'
);

create table documentos_emitidos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  tipo tipo_documento not null,
  formato text not null check (formato in ('pdf', 'xlsx')),
  unidad_id uuid references unidades(id) on delete set null,
  periodo date,
  votacion_id uuid references votaciones(id) on delete set null,
  codigo_verificacion text not null unique,     -- 10 caracteres, va en el QR
  sha256 text,                                  -- huella del archivo generado
  path text,                                    -- storage: documentos/<condominio>/<id>.<ext> (opcional)
  vigente_hasta date,                           -- solvencias
  emitido_por uuid references perfiles(id),
  emitido_en timestamptz not null default now(),
  anulado_en timestamptz
);
create index on documentos_emitidos (condominio_id, tipo, emitido_en desc);

create or replace function nuevo_codigo_verificacion() returns text
language sql volatile as $$
  -- Sin 0/O/1/I para que se pueda dictar por teléfono.
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
    from generate_series(1, 10);
$$;

-- Registra un documento generado (la app o el servidor lo genera con las plantillas).
create or replace function registrar_documento(p_condominio uuid, p_tipo tipo_documento, p_formato text,
  p_unidad uuid default null, p_periodo date default null, p_votacion uuid default null, p_sha256 text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_codigo text;
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  -- Un residente solo puede emitir documentos de su propia unidad; los demás tipos son de la junta.
  if not es_junta(p_condominio) and (p_unidad is null or p_unidad not in (select mis_unidades())
                                      or p_tipo not in ('estado_cuenta', 'recibo')) then
    raise exception 'Sin permiso para emitir este documento';
  end if;
  if p_tipo = 'solvencia' then raise exception 'Use emitir_solvencia()'; end if;
  v_codigo := nuevo_codigo_verificacion();
  insert into documentos_emitidos (condominio_id, tipo, formato, unidad_id, periodo, votacion_id, codigo_verificacion, sha256, emitido_por)
  values (p_condominio, p_tipo, p_formato, p_unidad, p_periodo, p_votacion, v_codigo, p_sha256, auth.uid());
  return v_codigo;
end $$;

-- Solvencia: solo si la unidad no debe nada. Vigente hasta fin de mes.
create or replace function emitir_solvencia(p_unidad uuid)
returns text language plpgsql security definer set search_path = public as $$
declare u unidades; v_saldo numeric; v_codigo text;
begin
  select * into u from unidades where id = p_unidad;
  if not found then raise exception 'Unidad no existe'; end if;
  if not (es_junta(u.condominio_id) or p_unidad in (select mis_unidades())) then raise exception 'Sin permiso'; end if;
  select saldo_usd into v_saldo from estado_cuenta_unidad where unidad_id = p_unidad;
  if coalesce(v_saldo, 0) > 0.009 then
    raise exception 'La unidad tiene un saldo pendiente de $%: no se puede emitir la solvencia', to_char(v_saldo, 'FM999G999D00');
  end if;
  v_codigo := nuevo_codigo_verificacion();
  insert into documentos_emitidos (condominio_id, tipo, formato, unidad_id, codigo_verificacion, vigente_hasta, emitido_por)
  values (u.condominio_id, 'solvencia', 'pdf', p_unidad, v_codigo,
          (date_trunc('month', current_date) + interval '1 month - 1 day')::date, auth.uid());
  return v_codigo;
end $$;

-- Verificación pública (sin iniciar sesión): quien escanea el QR ve solo lo mínimo.
create or replace function verificar_documento(p_codigo text)
returns table (tipo tipo_documento, condominio text, unidad text, emitido_en timestamptz, vigente boolean)
language sql stable security definer set search_path = public as $$
  select d.tipo, c.nombre, case when u.id is null then null else etiqueta_unidad(u) end, d.emitido_en,
         d.anulado_en is null and (d.vigente_hasta is null or d.vigente_hasta >= current_date)
    from documentos_emitidos d
    join condominios c on c.id = d.condominio_id
    left join unidades u on u.id = d.unidad_id
   where d.codigo_verificacion = upper(trim(p_codigo));
$$;

-- Datos completos para el acta de una votación (lista por apartamento, alícuota y opción).
-- Solo la junta: el acta lleva quién votó qué, para firmarla y sellarla.
create or replace function datos_acta_votacion(p_votacion uuid)
returns table (unidad text, propietario text, alicuota numeric, opcion text, emitido_en timestamptz, votante text)
language plpgsql stable security definer set search_path = public as $$
declare v votaciones;
begin
  select * into v from votaciones where id = p_votacion;
  if not found or not es_junta(v.condominio_id) then raise exception 'Sin permiso'; end if;
  return query
    select etiqueta_unidad(u), u.propietario_nombre, u.alicuota, o.texto, vt.emitido_en, p.nombre
      from unidades u
      left join votos vt on vt.unidad_id = u.id and vt.votacion_id = p_votacion
      left join votacion_opciones o on o.id = vt.opcion_id
      left join perfiles p on p.id = vt.emitido_por
     where u.condominio_id = v.condominio_id
     order by u.bloque nulls first, u.numero;
end $$;

alter table documentos_emitidos enable row level security;
create policy ver on documentos_emitidos for select using (
  es_junta(condominio_id) or (unidad_id is not null and unidad_id in (select mis_unidades())));
create policy anular on documentos_emitidos for update using (es_junta(condominio_id));

grant execute on function verificar_documento(text) to anon;
