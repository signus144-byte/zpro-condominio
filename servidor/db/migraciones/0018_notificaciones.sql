-- =====================================================================
-- ZPro Condominio · 0018 Notificaciones (bandeja de avisos de cada persona)
--
-- Decisión de Dirección (27-oct-2026), flujo de pagos:
--  1. La casa reporta su pago con el comprobante (captura del Pago Móvil, voucher…).
--  2. La junta (finanzas) lo concilia y lo APRUEBA o lo RECHAZA (con motivo).
--  3. En ambos casos se notifica a la casa correspondiente.
--  4. Mientras haya pagos sin revisar, la junta recibe un recordatorio (cada mañana y
--     un aviso fijo en la app) hasta que los apruebe o rechace.
--
-- Las notificaciones viven en la base de datos (se ven en la app aunque no haya Firebase);
-- cada una avisa por NOTIFY 'zpro_notificaciones' para el WebSocket, el push y el correo.
-- =====================================================================

create table notificaciones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references perfiles(id) on delete cascade,
  condominio_id uuid references condominios(id) on delete cascade,
  tipo text not null check (tipo in ('pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes',
                                     'chat_vecinos', 'general')),
  titulo text not null,
  cuerpo text not null,
  datos jsonb not null default '{}',      -- {"pagoId": …, "pantalla": "pagos"} para abrir lo que corresponde
  correo boolean not null default false,  -- además se envía por correo
  leida_en timestamptz,
  creado_en timestamptz not null default now()
);
create index notificaciones_usuario on notificaciones (usuario_id, creado_en desc);
create index notificaciones_no_leidas on notificaciones (usuario_id) where leida_en is null;

alter table notificaciones enable row level security;
create policy propias on notificaciones for select using (usuario_id = auth.uid());
-- Nadie inserta ni edita desde la app: las crean las funciones de abajo; leerlas se marca con marcar_notificaciones.
grant select on notificaciones to authenticated;

-- Preferencia de cada persona: recibir también por correo los avisos importantes.
alter table perfiles add column avisos_por_correo boolean not null default true;

create or replace function marcar_notificaciones(p_ids uuid[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  update notificaciones set leida_en = now()
   where usuario_id = auth.uid() and leida_en is null and (p_ids is null or id = any(p_ids));
  get diagnostics n = row_count;
  return n;
end $$;

-- Montos al estilo venezolano: 21.550,00
create or replace function formato_ve(x numeric) returns text
language sql immutable as $$
  select translate(to_char(coalesce(x, 0), 'FM999,999,999,990.00'), ',.', '.,');
$$;

create or replace function texto_monto_pago(p pagos) returns text
language sql stable as $$
  select case when p.moneda = 'VES' then 'Bs ' || formato_ve(p.monto) else '$' || formato_ve(p.monto) end;
$$;

-- Crea una notificación para cada usuario de la lista (función interna, no para la app).
create or replace function notificar(p_usuarios uuid[], p_condominio uuid, p_tipo text, p_titulo text, p_cuerpo text,
                                     p_datos jsonb default '{}', p_correo boolean default false)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  insert into notificaciones (usuario_id, condominio_id, tipo, titulo, cuerpo, datos, correo)
  select distinct u, p_condominio, p_tipo, p_titulo, p_cuerpo, coalesce(p_datos, '{}'), p_correo
    from unnest(p_usuarios) u where u is not null;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function notificar(uuid[], uuid, text, text, text, jsonb, boolean) from public, anon, authenticated;

-- Quienes manejan las finanzas de un condominio (los que aprueban o rechazan pagos).
create or replace function usuarios_finanzas(p_condominio uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct usuario_id), '{}') from membresias
   where condominio_id = p_condominio and activo and rol in ('presidente', 'tesorero', 'administrador');
$$;
revoke all on function usuarios_finanzas(uuid) from public, anon, authenticated;

-- ---------- Pagos de las casas ----------
create or replace function notificar_pago() returns trigger
language plpgsql security definer set search_path = public as $$
declare u unidades; casa text; saldo numeric; ref text;
begin
  select * into u from unidades where id = new.unidad_id;
  casa := etiqueta_unidad(u);
  ref := case when coalesce(new.referencia, '') <> '' then ' (ref. ' || new.referencia || ')' else '' end;

  if tg_op = 'INSERT' and new.estado = 'reportado' then
    perform notificar(usuarios_finanzas(new.condominio_id), new.condominio_id, 'pago_reportado',
      'Pago por revisar: ' || casa,
      casa || ' reportó ' || texto_monto_pago(new) || ref || '. Concílielo en el banco y apruébelo o recháselo.',
      jsonb_build_object('pagoId', new.id, 'pantalla', 'pagos'));
    return null;
  end if;

  if (tg_op = 'INSERT' and new.estado = 'confirmado')
     or (tg_op = 'UPDATE' and new.estado is distinct from old.estado and new.estado in ('confirmado', 'rechazado')) then
    if new.estado = 'confirmado' then
      select e.saldo_usd into saldo from estado_cuenta_unidad e where e.unidad_id = new.unidad_id;
      perform notificar(array(select usuarios_de_unidad(new.unidad_id)), new.condominio_id, 'pago_confirmado',
        'Pago aprobado',
        'La junta aprobó su pago de ' || texto_monto_pago(new) || ref || ' del ' || to_char(new.fecha_pago, 'DD/MM/YYYY') || '. '
          || case when coalesce(saldo, 0) > 0.009 then 'Saldo pendiente: $' || formato_ve(saldo) || '.'
                  else 'Está al día.' end,
        jsonb_build_object('pagoId', new.id, 'pantalla', 'estado-cuenta'), true);
    else
      perform notificar(array(select usuarios_de_unidad(new.unidad_id)), new.condominio_id, 'pago_rechazado',
        'Pago rechazado',
        'La junta rechazó su pago de ' || texto_monto_pago(new) || ref || '. Motivo: '
          || coalesce(nullif(trim(new.motivo_rechazo), ''), 'sin indicar') || '. Revise los datos y vuelva a reportarlo.',
        jsonb_build_object('pagoId', new.id, 'pantalla', 'estado-cuenta'), true);
    end if;
  end if;
  return null;
end $$;
create trigger pagos_notificar after insert or update of estado on pagos
  for each row execute function notificar_pago();

-- ---------- Recordatorio diario a la junta: pagos sin revisar ----------
-- Lo llama la tarea programada de la mañana. Una notificación por persona y por día (no se repite si ya hay una de hoy).
create or replace function recordar_pagos_pendientes()
returns table (condominio_id uuid, pendientes integer, notificados integer)
language plpgsql security definer set search_path = public as $$
declare r record; n integer; dias integer;
begin
  for r in
    select p.condominio_id as cid, count(*)::int as cuantos, min(p.creado_en) as desde,
           sum(case when p.moneda = 'VES' then p.monto else 0 end) as bs, sum(case when p.moneda = 'USD' then p.monto else 0 end) as usd
      from pagos p join condominios c on c.id = p.condominio_id
     where p.estado = 'reportado' and c.estado in ('prueba', 'activo', 'suspendido')
     group by p.condominio_id
  loop
    dias := greatest(0, (current_date - (r.desde at time zone 'America/Caracas')::date));
    select notificar(array(
             select x from unnest(usuarios_finanzas(r.cid)) x
              where not exists (select 1 from notificaciones k where k.usuario_id = x and k.condominio_id = r.cid
                                  and k.tipo = 'pagos_pendientes'
                                  and (k.creado_en at time zone 'America/Caracas')::date = (now() at time zone 'America/Caracas')::date)),
           r.cid, 'pagos_pendientes',
           case when r.cuantos = 1 then '1 pago por aprobar o rechazar' else r.cuantos || ' pagos por aprobar o rechazar' end,
           'Tiene ' || r.cuantos || case when r.cuantos = 1 then ' pago reportado' else ' pagos reportados' end
             || ' esperando revisión'
             || case when dias > 0 then ' (el más antiguo desde hace ' || dias || case when dias = 1 then ' día)' else ' días)' end else '' end
             || '. Total: ' || concat_ws(' + ', case when r.bs > 0 then 'Bs ' || formato_ve(r.bs) end,
                                                case when r.usd > 0 then '$' || formato_ve(r.usd) end)
             || '. Los residentes ven su pago "en revisión" hasta que usted lo apruebe o lo rechace.',
           jsonb_build_object('pantalla', 'pagos', 'pendientes', r.cuantos), true)
      into n;
    condominio_id := r.cid; pendientes := r.cuantos; notificados := n;
    return next;
  end loop;
end $$;
revoke all on function recordar_pagos_pendientes() from public, anon, authenticated;
grant execute on function recordar_pagos_pendientes() to servicio;

-- ---------- Chat entre vecinos: avisar a todos cuando la junta lo enciende o apaga ----------
create or replace function notificar_chat_vecinos() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.chat_vecinos is distinct from old.chat_vecinos then
    perform notificar(array(select distinct usuario_id from membresias where condominio_id = new.id and activo),
      new.id, 'chat_vecinos',
      case when new.chat_vecinos then 'Chat entre vecinos activado' else 'Chat entre vecinos desactivado' end,
      case when new.chat_vecinos
           then 'La junta habilitó el chat entre casas. Puede escribirle a otra casa desde el directorio.'
           else 'La junta desactivó el chat entre casas. Sus conversaciones quedan guardadas, pero ya no se pueden enviar mensajes. El chat con la junta sigue igual.' end,
      jsonb_build_object('pantalla', 'chat'));
  end if;
  return null;
end $$;
create trigger condominios_chat_vecinos after update of chat_vecinos on condominios
  for each row execute function notificar_chat_vecinos();

-- ---------- Tiempo real ----------
create or replace function avisar_notificacion() returns trigger
language plpgsql as $$
begin
  perform pg_notify('zpro_notificaciones', json_build_object('id', new.id, 'usuario_id', new.usuario_id)::text);
  return null;
end $$;
create trigger notificaciones_avisar after insert on notificaciones
  for each row execute function avisar_notificacion();

-- Lo que el servidor necesita para el push y el correo de una notificación (solo el rol servicio).
create or replace function datos_envio_notificacion(p_id uuid)
returns table (titulo text, cuerpo text, tipo text, datos jsonb, correo boolean, email text, nombre text,
               avisos_por_correo boolean, condominio text, tokens text[])
language sql stable security definer set search_path = public, auth as $$
  select n.titulo, n.cuerpo, n.tipo, n.datos, n.correo,
         case when u.correo_verificado_en is not null then u.email::text end, p.nombre, p.avisos_por_correo, c.nombre,
         coalesce((select array_agg(d.token) from dispositivos d where d.usuario_id = n.usuario_id), '{}')
    from notificaciones n
    join perfiles p on p.id = n.usuario_id
    left join auth.users u on u.id = n.usuario_id
    left join condominios c on c.id = n.condominio_id
   where n.id = p_id;
$$;
revoke all on function datos_envio_notificacion(uuid) from public, anon, authenticated;
grant execute on function datos_envio_notificacion(uuid) to servicio;
