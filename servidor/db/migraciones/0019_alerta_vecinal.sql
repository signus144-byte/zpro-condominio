-- =====================================================================
-- ZPro Condominio · 0019 Alerta vecinal (botón de emergencia)
--
-- Idea de Dirección (28-oct-2026): ante una emergencia (delito, emergencia médica, incendio…)
-- una casa avisa a sus vecinos más cercanos y a la junta; los teléfonos suenan como alarma
-- y los vecinos responden si pueden ayudar ("voy en camino", "tengo vehículo"…).
--
-- Reglas:
--  * La junta enciende la red de alerta en su condominio y fija el radio (casas a cada lado).
--  * Participar es VOLUNTARIO: solo quien se inscribe puede emitir y recibir alertas de vecinos.
--    La junta siempre recibe las alertas de su condominio.
--  * Quien emite se identifica (huella/patrón en el teléfono, o su clave en la web) y responde
--    por el aviso: su nombre y su casa van en la alerta. Nada es anónimo.
--  * Contra el abuso: una alerta activa a la vez, máximo 3 por día por persona, la junta
--    marca falsas alarmas y puede suspender a alguien de la red.
--  * Incendio avisa a todo el condominio; los demás tipos, a las casas cercanas (se puede ampliar).
-- =====================================================================

create type tipo_alerta as enum ('seguridad', 'medica', 'incendio', 'otra');
create type estado_alerta as enum ('activa', 'atendida', 'falsa_alarma', 'cancelada', 'vencida');
create type respuesta_alerta as enum ('voy', 'vehiculo', 'llamo_autoridades', 'no_puedo');

-- ---------- Configuración ----------
alter table condominios
  add column alerta_activa boolean not null default false,
  add column alerta_radio smallint not null default 3 check (alerta_radio between 0 and 50);   -- 0 = todo el condominio

-- Cercanía: sector (calle, bloque, torre) y posición a lo largo de él. Por defecto: bloque y el número de la casa.
alter table unidades
  add column sector text,
  add column posicion integer;

create or replace function sector_unidad(u unidades) returns text
language sql immutable as $$ select upper(coalesce(nullif(trim(u.sector), ''), nullif(trim(u.bloque), ''), '')) $$;

create or replace function posicion_unidad(u unidades) returns integer
language sql immutable as $$
  select coalesce(u.posicion, nullif(substring(u.numero from '\d+'), '')::integer);
$$;

-- Unidades cercanas a una (sin incluirla): mismo sector y a lo sumo p_radio posiciones de distancia.
create or replace function unidades_cercanas(p_unidad uuid, p_radio integer)
returns setof uuid language sql stable security definer set search_path = public as $$
  select o.id from unidades u join unidades o on o.condominio_id = u.condominio_id and o.id <> u.id
   where u.id = p_unidad
     and (p_radio = 0
          or (sector_unidad(o) = sector_unidad(u)
              and posicion_unidad(o) is not null and posicion_unidad(u) is not null
              and abs(posicion_unidad(o) - posicion_unidad(u)) <= p_radio));
$$;
revoke all on function unidades_cercanas(uuid, integer) from public, anon;

-- ---------- Participantes (voluntarios) ----------
create table participantes_alerta (
  condominio_id uuid not null references condominios(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  activo boolean not null default true,
  tiene_vehiculo boolean not null default false,
  personal_salud boolean not null default false,       -- médico, enfermera, paramédico…
  telefono text,                                        -- visible solo dentro de una alerta
  inscrito_en timestamptz not null default now(),
  suspendido_hasta timestamptz,
  motivo_suspension text,
  primary key (condominio_id, usuario_id)
);

-- ---------- Alertas ----------
create table alertas (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  emisor_id uuid not null references perfiles(id) on delete cascade,
  tipo tipo_alerta not null,
  nota text check (length(nota) <= 300),
  alcance text not null check (alcance in ('cercanos', 'todos')),
  verificacion text not null check (verificacion in ('biometria', 'credencial', 'clave')),
  estado estado_alerta not null default 'activa',
  creado_en timestamptz not null default now(),
  cerrada_en timestamptz,
  cerrada_por uuid references perfiles(id),
  nota_cierre text
);
create index alertas_condominio on alertas (condominio_id, creado_en desc);
create index alertas_emisor on alertas (emisor_id, creado_en desc);

create table alerta_destinatarios (
  alerta_id uuid not null references alertas(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  motivo text not null check (motivo in ('cercano', 'condominio', 'junta', 'misma_casa')),
  visto_en timestamptz,
  primary key (alerta_id, usuario_id)
);

create table alerta_respuestas (
  alerta_id uuid not null references alertas(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  respuesta respuesta_alerta not null,
  creado_en timestamptz not null default now(),
  primary key (alerta_id, usuario_id)
);

alter table participantes_alerta enable row level security;
alter table alertas enable row level security;
alter table alerta_destinatarios enable row level security;
alter table alerta_respuestas enable row level security;

create or replace function puedo_ver_alerta(p_alerta uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from alertas a where a.id = p_alerta and (
           a.emisor_id = auth.uid() or es_junta(a.condominio_id)
           or exists (select 1 from alerta_destinatarios d where d.alerta_id = a.id and d.usuario_id = auth.uid())));
$$;

create policy propia on participantes_alerta for select using (usuario_id = auth.uid() or es_junta(condominio_id));
create policy ver on alertas for select using (puedo_ver_alerta(id));
create policy ver on alerta_destinatarios for select using (usuario_id = auth.uid() or puedo_ver_alerta(alerta_id));
create policy ver on alerta_respuestas for select using (puedo_ver_alerta(alerta_id));
grant select on participantes_alerta, alertas, alerta_destinatarios, alerta_respuestas to authenticated;

-- ---------- Notificaciones: dos tipos nuevos ----------
alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada'));

-- ---------- Junta: red y cercanía ----------
create or replace function configurar_red_alerta(p_condominio uuid, p_activa boolean, p_radio integer)
returns void language plpgsql security definer set search_path = public as $$
declare previo condominios;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración configura la alerta vecinal';
  end if;
  select * into previo from condominios where id = p_condominio for update;
  update condominios set alerta_activa = p_activa, alerta_radio = coalesce(p_radio, alerta_radio) where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (p_condominio, 'condominios', p_condominio, 'alerta_vecinal', auth.uid(),
          jsonb_build_object('activa', previo.alerta_activa, 'radio', previo.alerta_radio),
          jsonb_build_object('activa', p_activa, 'radio', coalesce(p_radio, previo.alerta_radio)));
  if previo.alerta_activa is distinct from p_activa then
    perform notificar(array(select distinct usuario_id from membresias where condominio_id = p_condominio and activo),
      p_condominio, 'general',
      case when p_activa then 'Alerta vecinal disponible' else 'Alerta vecinal desactivada' end,
      case when p_activa then 'La junta activó la alerta vecinal. Si quiere avisar o recibir avisos de emergencia de sus vecinos, inscríbase en Alerta vecinal.'
           else 'La junta desactivó la alerta vecinal en el condominio.' end,
      jsonb_build_object('pantalla', 'alerta'));
  end if;
end $$;

create or replace function fijar_cercania(p_condominio uuid, p_unidades uuid[], p_sectores text[], p_posiciones integer[])
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then raise exception 'Sin permiso'; end if;
  update unidades u set sector = nullif(trim(x.s), ''), posicion = x.p
    from unnest(p_unidades, p_sectores, p_posiciones) as x(id, s, p)
   where u.id = x.id and u.condominio_id = p_condominio;
  get diagnostics n = row_count;
  return n;
end $$;

-- ---------- Participación ----------
create or replace function inscribir_alerta(p_condominio uuid, p_activo boolean, p_vehiculo boolean, p_salud boolean, p_telefono text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membresias where condominio_id = p_condominio and usuario_id = auth.uid() and activo and unidad_id is not null) then
    raise exception 'Solo los residentes con casa registrada participan en la alerta vecinal';
  end if;
  insert into participantes_alerta (condominio_id, usuario_id, activo, tiene_vehiculo, personal_salud, telefono)
  values (p_condominio, auth.uid(), p_activo, coalesce(p_vehiculo, false), coalesce(p_salud, false), nullif(trim(p_telefono), ''))
  on conflict (condominio_id, usuario_id) do update
    set activo = excluded.activo, tiene_vehiculo = excluded.tiene_vehiculo,
        personal_salud = excluded.personal_salud, telefono = excluded.telefono;
end $$;

create or replace function suspender_de_alerta(p_condominio uuid, p_usuario uuid, p_dias integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then raise exception 'Sin permiso'; end if;
  update participantes_alerta
     set suspendido_hasta = case when p_dias > 0 then now() + make_interval(days => p_dias) end,
         motivo_suspension = case when p_dias > 0 then nullif(trim(p_motivo), '') end
   where condominio_id = p_condominio and usuario_id = p_usuario;
  if not found then raise exception 'Esa persona no participa en la alerta vecinal'; end if;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, despues)
  values (p_condominio, 'participantes_alerta', p_usuario, case when p_dias > 0 then 'suspender' else 'reactivar' end, auth.uid(),
          jsonb_build_object('dias', p_dias, 'motivo', p_motivo));
end $$;

-- ¿Puedo emitir? Devuelve null si sí, o el motivo si no.
create or replace function motivo_no_emitir(p_condominio uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare p participantes_alerta; n integer;
begin
  if not (select alerta_activa from condominios where id = p_condominio) then return 'La junta no ha activado la alerta vecinal'; end if;
  if not condominio_operativo(p_condominio) then return 'El condominio está suspendido'; end if;
  select * into p from participantes_alerta where condominio_id = p_condominio and usuario_id = auth.uid();
  if p.usuario_id is null or not p.activo then return 'Inscríbase en la alerta vecinal para poder avisar'; end if;
  if p.suspendido_hasta > now() then
    return 'La junta suspendió su participación hasta el ' || to_char(p.suspendido_hasta at time zone 'America/Caracas', 'DD/MM/YYYY');
  end if;
  if exists (select 1 from alertas where emisor_id = auth.uid() and condominio_id = p_condominio and estado = 'activa') then
    return 'Ya tiene una alerta activa';
  end if;
  select count(*) into n from alertas where emisor_id = auth.uid() and creado_en > now() - interval '24 hours';
  if n >= 3 then return 'Llegó al máximo de 3 alertas en 24 horas. Si es una emergencia, llame al 911 o a la junta'; end if;
  return null;
end $$;

-- ---------- Emitir ----------
create or replace function emitir_alerta(p_condominio uuid, p_tipo tipo_alerta, p_nota text, p_verificacion text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_motivo text; v_unidad uuid; v_alcance text; v_radio integer; v_id uuid; v_casa text; v_nombre text; v_titulo text; v_cuerpo text;
begin
  v_motivo := motivo_no_emitir(p_condominio);
  if v_motivo is not null then raise exception '%', v_motivo; end if;
  select m.unidad_id into v_unidad from membresias m
   where m.condominio_id = p_condominio and m.usuario_id = auth.uid() and m.activo and m.unidad_id is not null limit 1;
  v_alcance := case when p_tipo = 'incendio' then 'todos' else 'cercanos' end;
  select alerta_radio into v_radio from condominios where id = p_condominio;
  if v_radio = 0 then v_alcance := 'todos'; end if;

  insert into alertas (condominio_id, unidad_id, emisor_id, tipo, nota, alcance, verificacion)
  values (p_condominio, v_unidad, auth.uid(), p_tipo, nullif(trim(p_nota), ''), v_alcance, p_verificacion)
  returning id into v_id;

  -- Destinatarios: vecinos inscritos (cercanos o todos), la familia de la misma casa y la junta.
  insert into alerta_destinatarios (alerta_id, usuario_id, motivo)
  select v_id, x.u, min(x.m) from (
    select pa.usuario_id as u, case when v_alcance = 'todos' then 'condominio' else 'cercano' end as m
      from participantes_alerta pa join membresias m on m.usuario_id = pa.usuario_id and m.condominio_id = pa.condominio_id and m.activo
     where pa.condominio_id = p_condominio and pa.activo and coalesce(pa.suspendido_hasta, now()) <= now()
       and (v_alcance = 'todos' or m.unidad_id in (select unidades_cercanas(v_unidad, v_radio)))
    union all
    select m.usuario_id, 'misma_casa' from membresias m where m.unidad_id = v_unidad and m.activo
    union all
    select m.usuario_id, 'junta' from membresias m
     where m.condominio_id = p_condominio and m.activo and m.rol in ('presidente','tesorero','vocal','administrador')
  ) x where x.u <> auth.uid()
  group by x.u;

  select etiqueta_unidad(u) into v_casa from unidades u where u.id = v_unidad;
  select nombre into v_nombre from perfiles where id = auth.uid();
  v_titulo := '🚨 ' || case p_tipo when 'seguridad' then 'Emergencia de seguridad' when 'medica' then 'Emergencia médica'
                                   when 'incendio' then 'Incendio' else 'Emergencia' end || ' en ' || v_casa;
  v_cuerpo := v_nombre || ' (' || v_casa || ') pide ayuda.' || coalesce(' «' || nullif(trim(p_nota), '') || '»', '')
              || ' Abra la alerta para responder.';
  perform notificar(array(select usuario_id from alerta_destinatarios where alerta_id = v_id), p_condominio, 'alerta',
                    v_titulo, v_cuerpo, jsonb_build_object('alertaId', v_id, 'pantalla', 'alerta', 'tipoAlerta', p_tipo));
  perform pg_notify('zpro_alertas', json_build_object('alerta_id', v_id, 'evento', 'nueva')::text);
  return v_id;
end $$;

-- Ampliar a todo el condominio (quien la emitió o la junta).
create or replace function ampliar_alerta(p_alerta uuid) returns integer
language plpgsql security definer set search_path = public as $$
declare a alertas; n integer; v_casa text;
begin
  select * into a from alertas where id = p_alerta for update;
  if a.id is null or not (a.emisor_id = auth.uid() or es_junta(a.condominio_id)) then raise exception 'Sin permiso'; end if;
  if a.estado <> 'activa' then raise exception 'La alerta ya está cerrada'; end if;
  if a.alcance = 'todos' then return 0; end if;
  update alertas set alcance = 'todos' where id = p_alerta;
  with nuevos as (
    insert into alerta_destinatarios (alerta_id, usuario_id, motivo)
    select distinct p_alerta, pa.usuario_id, 'condominio' from participantes_alerta pa
     where pa.condominio_id = a.condominio_id and pa.activo and coalesce(pa.suspendido_hasta, now()) <= now()
       and pa.usuario_id <> a.emisor_id
    on conflict do nothing returning usuario_id)
  select count(*) into n from nuevos;
  select etiqueta_unidad(u) into v_casa from unidades u where u.id = a.unidad_id;
  perform notificar(array(select d.usuario_id from alerta_destinatarios d where d.alerta_id = p_alerta and d.motivo = 'condominio'
                            and not exists (select 1 from notificaciones k where k.usuario_id = d.usuario_id and k.tipo = 'alerta'
                                              and k.datos->>'alertaId' = p_alerta::text)),
                    a.condominio_id, 'alerta',
                    '🚨 Emergencia en ' || v_casa || ' (aviso a todo el condominio)',
                    'Se amplió una alerta de ' || v_casa || ' a todo el condominio. Abra la alerta para responder.',
                    jsonb_build_object('alertaId', p_alerta, 'pantalla', 'alerta', 'tipoAlerta', a.tipo));
  perform pg_notify('zpro_alertas', json_build_object('alerta_id', p_alerta, 'evento', 'ampliada')::text);
  return n;
end $$;

-- ---------- Responder y marcar visto ----------
create or replace function responder_alerta(p_alerta uuid, p_respuesta respuesta_alerta) returns void
language plpgsql security definer set search_path = public as $$
declare a alertas;
begin
  select * into a from alertas where id = p_alerta;
  if a.id is null or not exists (select 1 from alerta_destinatarios where alerta_id = p_alerta and usuario_id = auth.uid()) then
    raise exception 'Sin permiso';
  end if;
  if a.estado <> 'activa' then raise exception 'La alerta ya está cerrada'; end if;
  insert into alerta_respuestas (alerta_id, usuario_id, respuesta) values (p_alerta, auth.uid(), p_respuesta)
  on conflict (alerta_id, usuario_id) do update set respuesta = excluded.respuesta, creado_en = now();
  update alerta_destinatarios set visto_en = coalesce(visto_en, now()) where alerta_id = p_alerta and usuario_id = auth.uid();
  perform pg_notify('zpro_alertas', json_build_object('alerta_id', p_alerta, 'evento', 'respuesta')::text);
end $$;

create or replace function marcar_alerta_vista(p_alerta uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update alerta_destinatarios set visto_en = now() where alerta_id = p_alerta and usuario_id = auth.uid() and visto_en is null;
  if found then perform pg_notify('zpro_alertas', json_build_object('alerta_id', p_alerta, 'evento', 'visto')::text); end if;
end $$;

-- ---------- Cerrar ----------
create or replace function cerrar_alerta(p_alerta uuid, p_estado estado_alerta, p_nota text) returns void
language plpgsql security definer set search_path = public as $$
declare a alertas; v_casa text;
begin
  select * into a from alertas where id = p_alerta for update;
  if a.id is null or not (a.emisor_id = auth.uid() or es_junta(a.condominio_id)) then raise exception 'Sin permiso'; end if;
  if a.estado <> 'activa' then raise exception 'La alerta ya está cerrada'; end if;
  if p_estado not in ('atendida', 'falsa_alarma', 'cancelada') then raise exception 'Estado inválido'; end if;
  if p_estado = 'falsa_alarma' and not es_junta(a.condominio_id) and a.emisor_id <> auth.uid() then raise exception 'Sin permiso'; end if;
  update alertas set estado = p_estado, cerrada_en = now(), cerrada_por = auth.uid(), nota_cierre = nullif(trim(p_nota), '')
   where id = p_alerta;
  select etiqueta_unidad(u) into v_casa from unidades u where u.id = a.unidad_id;
  perform notificar(array(select usuario_id from alerta_destinatarios where alerta_id = p_alerta), a.condominio_id, 'alerta_cerrada',
    case p_estado when 'atendida' then '✅ Emergencia atendida en ' || v_casa
                  when 'falsa_alarma' then 'Falsa alarma en ' || v_casa else 'Alerta cancelada en ' || v_casa end,
    case p_estado when 'atendida' then 'La situación en ' || v_casa || ' ya fue atendida. Gracias a quienes respondieron.'
                  when 'falsa_alarma' then 'La alerta de ' || v_casa || ' fue una falsa alarma. No hace falta acudir.'
                  else 'Quien emitió la alerta la canceló. No hace falta acudir.' end
      || coalesce(' Nota: ' || nullif(trim(p_nota), ''), ''),
    jsonb_build_object('alertaId', p_alerta, 'pantalla', 'alerta'));
  perform pg_notify('zpro_alertas', json_build_object('alerta_id', p_alerta, 'evento', 'cerrada')::text);
end $$;

-- Alertas olvidadas: a las 3 horas se cierran solas como "vencida" (tarea programada, rol servicio).
create or replace function vencer_alertas(p_horas integer default 3) returns integer
language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with v as (update alertas set estado = 'vencida', cerrada_en = now()
              where estado = 'activa' and creado_en < now() - make_interval(hours => p_horas) returning id)
  select count(*) into n from v;
  return n;
end $$;
revoke all on function vencer_alertas(integer) from public, anon, authenticated;
grant execute on function vencer_alertas(integer) to servicio;

-- Usuarios que deben enterarse de cambios en una alerta (para el WebSocket): emisor, destinatarios y junta.
create or replace function usuarios_alerta(p_alerta uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select emisor_id from alertas where id = p_alerta
  union select usuario_id from alerta_destinatarios where alerta_id = p_alerta
  union select m.usuario_id from alertas a join membresias m on m.condominio_id = a.condominio_id and m.activo
         and m.rol in ('presidente','tesorero','vocal','administrador') where a.id = p_alerta;
$$;
revoke all on function usuarios_alerta(uuid) from public, anon, authenticated;
grant execute on function usuarios_alerta(uuid) to servicio;

-- Detalle de una alerta para quien puede verla: teléfonos y datos de ayuda SOLO dentro de la alerta.
create or replace function detalle_alerta(p_alerta uuid)
returns table (id uuid, condominio_id uuid, tipo tipo_alerta, nota text, alcance text, estado estado_alerta, verificacion text,
               creado_en timestamptz, cerrada_en timestamptz, nota_cierre text, emisor_id uuid, emisor text, unidad text,
               emisor_telefono text, destinatarios integer, vistos integer, respuestas jsonb)
language plpgsql stable security definer set search_path = public as $$
begin
  if not puedo_ver_alerta(p_alerta) then raise exception 'Sin permiso'; end if;
  return query
    select a.id, a.condominio_id, a.tipo, a.nota, a.alcance, a.estado, a.verificacion, a.creado_en, a.cerrada_en, a.nota_cierre,
           a.emisor_id, p.nombre, etiqueta_unidad(u),
           coalesce(pa.telefono, p.telefono),
           (select count(*)::int from alerta_destinatarios d where d.alerta_id = a.id),
           (select count(*)::int from alerta_destinatarios d where d.alerta_id = a.id and d.visto_en is not null),
           coalesce((select jsonb_agg(jsonb_build_object(
                       'usuarioId', r.usuario_id, 'nombre', rp.nombre,
                       'unidad', (select etiqueta_unidad(uu) from membresias mm join unidades uu on uu.id = mm.unidad_id
                                   where mm.usuario_id = r.usuario_id and mm.condominio_id = a.condominio_id and mm.activo limit 1),
                       'respuesta', r.respuesta, 'creadoEn', r.creado_en,
                       'tieneVehiculo', coalesce(rpa.tiene_vehiculo, false), 'personalSalud', coalesce(rpa.personal_salud, false),
                       'telefono', case when r.respuesta <> 'no_puedo' then coalesce(rpa.telefono, rp.telefono) end)
                     order by r.creado_en)
                       from alerta_respuestas r join perfiles rp on rp.id = r.usuario_id
                       left join participantes_alerta rpa on rpa.usuario_id = r.usuario_id and rpa.condominio_id = a.condominio_id
                      where r.alerta_id = a.id), '[]'::jsonb)
      from alertas a
      join perfiles p on p.id = a.emisor_id
      join unidades u on u.id = a.unidad_id
      left join participantes_alerta pa on pa.usuario_id = a.emisor_id and pa.condominio_id = a.condominio_id
     where a.id = p_alerta;
end $$;

-- Datos de envío: para las alertas el push debe sonar como alarma (canal propio en Android).
-- (datos_envio_notificacion ya devuelve el tipo; el servidor elige el canal.)
