-- =====================================================================
-- Vecinos ZPro · 0025 Transparencia y convivencia
-- =====================================================================
--  1) Lista pública de casas con cuotas vencidas: OPCIONAL (la decide presidencia o la administración).
--     Modos: 'no' (apagada, por defecto), 'casas' (solo la casa y los meses vencidos), 'casas_y_montos' (también el monto).
--     Nunca muestra nombres de personas. Se puede exigir un mínimo de meses vencidos.
--  2) Mensajes anónimos a otra casa: un vecino le escribe a la casa 27 sin revelar quién es (queja, aviso, foto).
--     La casa puede responder (sin saber a quién) y puede denunciar un mensaje ofensivo: la junta ve el CONTENIDO,
--     nunca el remitente, y puede suspender al remitente sin conocerlo. Límites contra el acoso.
--  3) Reportes a la junta: casa relacionada opcional (solo la ven la junta y el autor) y "también a la casa".
-- La autoría de lo anónimo queda en tablas SIN políticas RLS: nadie la lee desde la app, ni la junta ni
-- Technical Digital TD. El servidor la usa solo para los límites, las respuestas y las suspensiones.

-- ---------- Configuración del condominio ----------
alter table condominios
  add column morosos_publicos text not null default 'no' check (morosos_publicos in ('no', 'casas', 'casas_y_montos')),
  add column morosos_meses_min smallint not null default 1 check (morosos_meses_min between 1 and 12),
  add column mensajes_anonimos boolean not null default true;

create or replace function fijar_convivencia(p_condominio uuid, p_morosos text, p_meses smallint, p_anonimos boolean)
returns void language plpgsql security definer set search_path = public as $$
declare c condominios;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración cambia estas opciones';
  end if;
  if p_morosos not in ('no', 'casas', 'casas_y_montos') then raise exception 'Opción no válida'; end if;
  if p_meses not between 1 and 12 then raise exception 'Los meses deben estar entre 1 y 12'; end if;
  select * into c from condominios where id = p_condominio for update;
  update condominios set morosos_publicos = p_morosos, morosos_meses_min = p_meses, mensajes_anonimos = p_anonimos
   where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (p_condominio, 'condominios', p_condominio, 'convivencia', auth.uid(),
          jsonb_build_object('morosos_publicos', c.morosos_publicos, 'morosos_meses_min', c.morosos_meses_min, 'mensajes_anonimos', c.mensajes_anonimos),
          jsonb_build_object('morosos_publicos', p_morosos, 'morosos_meses_min', p_meses, 'mensajes_anonimos', p_anonimos));
  -- Al encender la lista se avisa a todos (que nadie se entere por sorpresa).
  if c.morosos_publicos = 'no' and p_morosos <> 'no' then
    perform notificar(array(select distinct m.usuario_id from membresias m where m.condominio_id = p_condominio and m.activo),
      p_condominio, 'general', 'Lista de cuotas vencidas',
      'La junta publicará en la app las casas con ' || p_meses || ' o más ' || case when p_meses = 1 then 'mes' else 'meses' end
      || ' de cuotas vencidas' || case when p_morosos = 'casas_y_montos' then ' y el monto que deben' else '' end
      || '. No se muestran nombres. Si tiene pagos pendientes, póngase al día desde "Pagar".',
      jsonb_build_object('pantalla', 'morosos'));
  end if;
end $$;
grant execute on function fijar_convivencia(uuid, text, smallint, boolean) to authenticated;

-- ---------- Casas con cuotas vencidas ----------
-- Vencido = lo que falta por pagar de recibos cuya fecha de vencimiento ya pasó.
-- p_vista_previa: la junta ve la lista aunque esté apagada (para decidir).
create or replace function morosos_publicos(p_condominio uuid, p_vista_previa boolean default false)
returns table (unidad_id uuid, etiqueta text, meses_vencidos integer, monto_vencido_usd numeric, desde date)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare c condominios; hoy date := hoy_caracas();
begin
  select * into c from condominios where id = p_condominio;
  if c.id is null or not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  if c.morosos_publicos = 'no' and not (p_vista_previa and es_junta(p_condominio)) then
    raise exception 'La junta no ha publicado la lista de cuotas vencidas';
  end if;
  return query
  with pend as (
    select x.unidad_id, x.periodo,
           greatest(x.monto_usd - coalesce(a.pagado, 0), 0) as falta,
           coalesce(r.vence, x.periodo + (c.dia_vencimiento - 1)) as vence
      from cargos x
      left join recibos r on r.id = x.recibo_id
      left join (select cargo_id, sum(monto_usd) pagado from pago_aplicaciones group by cargo_id) a on a.cargo_id = x.id
     where x.condominio_id = p_condominio and x.monto_usd > 0
  ), venc as (
    select pend.unidad_id, count(distinct pend.periodo)::int as meses, sum(pend.falta) as monto, min(pend.periodo) as desde
      from pend where pend.falta > 0.009 and pend.vence < hoy group by pend.unidad_id
  )
  select u.id, etiqueta_unidad(u), v.meses,
         case when c.morosos_publicos = 'casas_y_montos' or (p_vista_previa and es_junta(p_condominio)) then round(v.monto, 2) end,
         v.desde
    from venc v join unidades u on u.id = v.unidad_id
   where v.meses >= c.morosos_meses_min
   order by v.meses desc, v.monto desc, u.bloque nulls first, u.numero;
end $$;
grant execute on function morosos_publicos(uuid, boolean) to authenticated;

-- ---------- Mensajes anónimos a una casa ----------
create table mensajes_anonimos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  a_unidad_id uuid not null references unidades(id) on delete cascade,
  categoria categoria_reporte not null default 'otro',
  texto text not null check (length(texto) between 3 and 2000),
  fotos text[] not null default '{}',            -- storage: anonimos/<condominio>/<mensaje>/<n>.jpg (sin EXIF)
  reporte_id uuid references reportes(id) on delete set null,   -- si también se envió a la junta
  leido_en timestamptz,
  denunciado_en timestamptz,
  motivo_denuncia text,
  revision text check (revision in ('bloqueado', 'descartada')),   -- decisión de la junta sobre la denuncia
  creado_en timestamptz not null default now()
);
create index on mensajes_anonimos (a_unidad_id, creado_en desc);
create index on mensajes_anonimos (condominio_id, denunciado_en);

-- Quién lo envió: SIN políticas RLS (nadie lo lee desde la app).
create table mensajes_anonimos_autoria (
  mensaje_id uuid primary key references mensajes_anonimos(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  creado_en timestamptz not null default now()
);
create index on mensajes_anonimos_autoria (usuario_id, creado_en desc);

create table mensajes_anonimos_respuestas (
  id uuid primary key default gen_random_uuid(),
  mensaje_id uuid not null references mensajes_anonimos(id) on delete cascade,
  de text not null check (de in ('casa', 'remitente')),
  texto text not null check (length(texto) between 1 and 1000),
  creado_en timestamptz not null default now()
);
create index on mensajes_anonimos_respuestas (mensaje_id, creado_en);

-- Suspensiones (la junta suspende sin saber a quién): SIN políticas RLS.
create table bloqueos_anonimos (
  id bigint generated always as identity primary key,
  condominio_id uuid not null references condominios(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  hasta timestamptz not null,
  mensaje_id uuid references mensajes_anonimos(id) on delete set null,
  creado_en timestamptz not null default now()
);

alter table mensajes_anonimos enable row level security;
alter table mensajes_anonimos_autoria enable row level security;
alter table mensajes_anonimos_respuestas enable row level security;
alter table bloqueos_anonimos enable row level security;
revoke all on mensajes_anonimos_autoria, bloqueos_anonimos from authenticated, anon;

-- ¿Puedo ver este mensaje? La casa destinataria, quien lo envió, y la junta SOLO si fue denunciado.
create or replace function puedo_ver_mensaje_anonimo(p_mensaje uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from mensajes_anonimos m where m.id = p_mensaje and (
      m.a_unidad_id in (select mis_unidades())
      or exists (select 1 from mensajes_anonimos_autoria a where a.mensaje_id = m.id and a.usuario_id = auth.uid())
      or (m.denunciado_en is not null and es_junta(m.condominio_id))));
$$;
create policy ver on mensajes_anonimos for select using (puedo_ver_mensaje_anonimo(id));
create policy ver on mensajes_anonimos_respuestas for select using (puedo_ver_mensaje_anonimo(mensaje_id));

insert into storage.buckets (id, name, public) values ('anonimos', 'anonimos', false) on conflict (id) do nothing;
create policy anonimos_ver on storage.objects for select to authenticated using (
  bucket_id = 'anonimos' and puedo_ver_mensaje_anonimo(((storage.foldername(name))[2])::uuid));

create or replace function anonimo_bloqueado(p_condominio uuid) returns timestamptz
language sql stable security definer set search_path = public as $$
  select max(hasta) from bloqueos_anonimos where condominio_id = p_condominio and usuario_id = auth.uid() and hasta > now();
$$;

-- Enviar. p_id lo genera el servidor (las fotos ya se guardaron sin dueño en anonimos/<cid>/<p_id>/).
create or replace function enviar_mensaje_anonimo(p_id uuid, p_condominio uuid, p_a_unidad uuid, p_categoria categoria_reporte,
                                                  p_texto text, p_fotos text[] default '{}', p_reporte uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare n integer; v_hasta timestamptz; u unidades;
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  if not (select mensajes_anonimos from condominios where id = p_condominio) then
    raise exception 'La junta de condominio desactivó los mensajes anónimos entre casas';
  end if;
  select * into u from unidades where id = p_a_unidad and condominio_id = p_condominio;
  if u.id is null then raise exception 'Esa casa no existe en este condominio'; end if;
  if p_a_unidad in (select mis_unidades()) then raise exception 'No puede enviarse un mensaje anónimo a su propia casa'; end if;
  if not exists (select 1 from membresias m where m.unidad_id = p_a_unidad and m.activo) then
    raise exception 'Esa casa todavía no usa la app: envíe el reporte a la junta';
  end if;
  v_hasta := anonimo_bloqueado(p_condominio);
  if v_hasta is not null then
    raise exception 'La junta suspendió sus mensajes anónimos hasta el % por un mensaje denunciado', to_char(v_hasta at time zone 'America/Caracas', 'DD/MM/YYYY');
  end if;
  -- Contra el acoso: 3 por día en total y 1 por día a la misma casa.
  select count(*) into n from mensajes_anonimos_autoria a where a.usuario_id = auth.uid() and a.creado_en > now() - interval '24 hours';
  if n >= 3 then raise exception 'Límite de 3 mensajes anónimos por día alcanzado'; end if;
  select count(*) into n from mensajes_anonimos_autoria a join mensajes_anonimos m on m.id = a.mensaje_id
   where a.usuario_id = auth.uid() and m.a_unidad_id = p_a_unidad and a.creado_en > now() - interval '24 hours';
  if n >= 1 then raise exception 'Ya le envió un mensaje anónimo a esa casa hoy. Espere su respuesta o escriba mañana'; end if;
  if p_reporte is not null and not exists (select 1 from reportes_autoria_privada a where a.reporte_id = p_reporte and a.usuario_id = auth.uid()) then
    raise exception 'Sin permiso';
  end if;

  insert into mensajes_anonimos (id, condominio_id, a_unidad_id, categoria, texto, fotos, reporte_id)
  values (p_id, p_condominio, p_a_unidad, p_categoria, trim(p_texto), coalesce(p_fotos, '{}'), p_reporte);
  insert into mensajes_anonimos_autoria (mensaje_id, usuario_id) values (p_id, auth.uid());
  perform notificar(array(select usuarios_de_unidad(p_a_unidad)), p_condominio, 'mensaje_anonimo',
    'Mensaje anónimo de un vecino',
    'Un vecino le dejó un mensaje sin su nombre' || case when p_reporte is not null then ' (también lo recibió la junta)' else '' end
    || '. Puede leerlo y responder sin saber quién es.',
    jsonb_build_object('pantalla', 'anonimos', 'mensajeId', p_id));
  return p_id;
end $$;
grant execute on function enviar_mensaje_anonimo(uuid, uuid, uuid, categoria_reporte, text, text[], uuid) to authenticated;

-- Bandeja: recibidos (de mis casas) y enviados (por mí). El remitente NUNCA sale en la respuesta.
create or replace function mis_mensajes_anonimos(p_condominio uuid)
returns table (id uuid, direccion text, a_unidad text, categoria categoria_reporte, texto text, fotos text[], tambien_junta boolean,
               leido_en timestamptz, denunciado_en timestamptz, revision text, creado_en timestamptz, respuestas jsonb)
language sql stable security definer set search_path = public as $$
  select m.id,
         case when m.a_unidad_id in (select mis_unidades()) then 'recibido' else 'enviado' end,
         etiqueta_unidad(u), m.categoria, m.texto, m.fotos, m.reporte_id is not null,
         m.leido_en, m.denunciado_en, m.revision, m.creado_en,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'de', r.de, 'texto', r.texto, 'creadoEn', r.creado_en) order by r.creado_en)
                     from mensajes_anonimos_respuestas r where r.mensaje_id = m.id), '[]')
    from mensajes_anonimos m join unidades u on u.id = m.a_unidad_id
   where m.condominio_id = p_condominio
     and (m.a_unidad_id in (select mis_unidades())
          or exists (select 1 from mensajes_anonimos_autoria a where a.mensaje_id = m.id and a.usuario_id = auth.uid()))
   order by m.creado_en desc
   limit 200;
$$;
grant execute on function mis_mensajes_anonimos(uuid) to authenticated;

create or replace function marcar_mensaje_anonimo_leido(p_mensaje uuid) returns void
language sql security definer set search_path = public as $$
  update mensajes_anonimos set leido_en = coalesce(leido_en, now())
   where id = p_mensaje and a_unidad_id in (select mis_unidades());
$$;
grant execute on function marcar_mensaje_anonimo_leido(uuid) to authenticated;

-- Responder: la casa al remitente (sin saber quién es) o el remitente a la casa (sigue anónimo).
create or replace function responder_mensaje_anonimo(p_mensaje uuid, p_texto text) returns void
language plpgsql security definer set search_path = public as $$
declare m mensajes_anonimos; v_de text; v_autor uuid; n integer;
begin
  select * into m from mensajes_anonimos where id = p_mensaje;
  if m.id is null then raise exception 'Mensaje no existe'; end if;
  select usuario_id into v_autor from mensajes_anonimos_autoria where mensaje_id = p_mensaje;
  if m.a_unidad_id in (select mis_unidades()) then v_de := 'casa';
  elsif v_autor = auth.uid() then v_de := 'remitente';
  else raise exception 'Sin permiso'; end if;
  if m.revision = 'bloqueado' then raise exception 'Esta conversación fue cerrada por la junta'; end if;
  if v_de = 'remitente' and anonimo_bloqueado(m.condominio_id) is not null then
    raise exception 'La junta suspendió sus mensajes anónimos por un mensaje denunciado';
  end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escriba la respuesta'; end if;
  select count(*) into n from mensajes_anonimos_respuestas where mensaje_id = p_mensaje and de = v_de;
  if n >= 10 then raise exception 'Esta conversación llegó a su límite de respuestas'; end if;
  insert into mensajes_anonimos_respuestas (mensaje_id, de, texto) values (p_mensaje, v_de, trim(p_texto));
  if v_de = 'casa' then
    perform notificar(array[v_autor], m.condominio_id, 'mensaje_anonimo', 'Respondieron su mensaje anónimo',
      etiqueta_unidad((select u from unidades u where u.id = m.a_unidad_id)) || ' respondió a su mensaje. Ellos no saben quién es usted.',
      jsonb_build_object('pantalla', 'anonimos', 'mensajeId', m.id));
  else
    update mensajes_anonimos set leido_en = null where id = p_mensaje;
    perform notificar(array(select usuarios_de_unidad(m.a_unidad_id)), m.condominio_id, 'mensaje_anonimo',
      'Nueva respuesta anónima', 'El vecino que le escribió respondió.', jsonb_build_object('pantalla', 'anonimos', 'mensajeId', m.id));
  end if;
end $$;
grant execute on function responder_mensaje_anonimo(uuid, text) to authenticated;

-- La casa que lo recibió lo denuncia como ofensivo o falso: la junta ve el contenido (no el remitente).
create or replace function denunciar_mensaje_anonimo(p_mensaje uuid, p_motivo text) returns void
language plpgsql security definer set search_path = public as $$
declare m mensajes_anonimos;
begin
  select * into m from mensajes_anonimos where id = p_mensaje;
  if m.id is null or m.a_unidad_id not in (select mis_unidades()) then raise exception 'Sin permiso'; end if;
  if m.denunciado_en is not null then raise exception 'Ese mensaje ya fue denunciado'; end if;
  if coalesce(length(trim(p_motivo)), 0) < 3 then raise exception 'Indique por qué lo denuncia'; end if;
  update mensajes_anonimos set denunciado_en = now(), motivo_denuncia = trim(p_motivo) where id = p_mensaje;
  perform notificar(usuarios_junta(m.condominio_id), m.condominio_id, 'denuncia_anonima', 'Mensaje anónimo denunciado',
    etiqueta_unidad((select u from unidades u where u.id = m.a_unidad_id)) || ' denunció un mensaje anónimo que recibió. Revíselo: puede suspender al remitente sin saber quién es.',
    jsonb_build_object('pantalla', 'denuncias', 'mensajeId', m.id));
end $$;
grant execute on function denunciar_mensaje_anonimo(uuid, text) to authenticated;

-- Junta: mensajes denunciados (contenido, casa que lo recibió y motivo; NUNCA el remitente).
create or replace function denuncias_anonimas(p_condominio uuid)
returns table (id uuid, a_unidad text, categoria categoria_reporte, texto text, fotos text[], motivo text,
               denunciado_en timestamptz, revision text, creado_en timestamptz, respuestas jsonb, reincidente boolean)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
begin
  if not es_junta(p_condominio) then raise exception 'Sin permiso'; end if;
  return query
  select m.id, etiqueta_unidad(u), m.categoria, m.texto, m.fotos, m.motivo_denuncia, m.denunciado_en, m.revision, m.creado_en,
         coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'de', r.de, 'texto', r.texto, 'creadoEn', r.creado_en) order by r.creado_en)
                     from mensajes_anonimos_respuestas r where r.mensaje_id = m.id), '[]'),
         -- ¿El mismo remitente ya tuvo otro mensaje denunciado? (se dice sí/no, nunca quién)
         exists (select 1 from mensajes_anonimos_autoria a join mensajes_anonimos_autoria b on b.usuario_id = a.usuario_id and b.mensaje_id <> a.mensaje_id
                  join mensajes_anonimos o on o.id = b.mensaje_id
                  where a.mensaje_id = m.id and o.denunciado_en is not null)
    from mensajes_anonimos m join unidades u on u.id = m.a_unidad_id
   where m.condominio_id = p_condominio and m.denunciado_en is not null
   order by (m.revision is null) desc, m.denunciado_en desc;
end $$;
grant execute on function denuncias_anonimas(uuid) to authenticated;

-- Junta decide: 'bloquear' (suspende al remitente N días sin saber quién es y cierra la conversación) o 'descartar'.
create or replace function revisar_denuncia_anonima(p_mensaje uuid, p_accion text, p_dias integer default 30) returns void
language plpgsql security definer set search_path = public as $$
declare m mensajes_anonimos; v_autor uuid;
begin
  select * into m from mensajes_anonimos where id = p_mensaje;
  if m.id is null or not es_junta(m.condominio_id) or m.denunciado_en is null then raise exception 'Sin permiso'; end if;
  if p_accion not in ('bloquear', 'descartar') then raise exception 'Acción no válida'; end if;
  if p_dias not between 1 and 365 then raise exception 'Los días deben estar entre 1 y 365'; end if;
  update mensajes_anonimos set revision = case when p_accion = 'bloquear' then 'bloqueado' else 'descartada' end where id = p_mensaje;
  if p_accion = 'bloquear' then
    select usuario_id into v_autor from mensajes_anonimos_autoria where mensaje_id = p_mensaje;
    insert into bloqueos_anonimos (condominio_id, usuario_id, hasta, mensaje_id)
    values (m.condominio_id, v_autor, now() + make_interval(days => p_dias), p_mensaje);
    perform notificar(array[v_autor], m.condominio_id, 'general', 'Mensajes anónimos suspendidos',
      'La junta revisó un mensaje anónimo suyo que fue denunciado y suspendió sus mensajes anónimos por ' || p_dias
      || ' días. La junta no sabe quién es usted.', jsonb_build_object('pantalla', 'anonimos'));
  end if;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (m.condominio_id, 'mensajes_anonimos', m.id, 'revision_denuncia', auth.uid(), null,
          jsonb_build_object('accion', p_accion, 'dias', case when p_accion = 'bloquear' then p_dias end));
end $$;
grant execute on function revisar_denuncia_anonima(uuid, text, integer) to authenticated;

-- ---------- Reportes a la junta: casa relacionada ----------
alter table reportes add column unidad_id uuid references unidades(id) on delete set null;
comment on column reportes.unidad_id is 'Casa a la que se refiere el reporte (la ven solo la junta y el autor)';

drop function if exists crear_reporte(uuid, categoria_reporte, text, text, text, boolean, visibilidad_reporte, text[]);
create or replace function crear_reporte(
  p_condominio uuid, p_categoria categoria_reporte, p_titulo text, p_descripcion text,
  p_ubicacion text, p_anonimo boolean, p_visibilidad visibilidad_reporte, p_fotos text[] default '{}', p_unidad uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hoy integer; f text;
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  select count(*) into v_hoy from reportes_autoria_privada a
    where a.usuario_id = auth.uid() and a.creado_en > now() - interval '24 hours';
  if v_hoy >= 5 then raise exception 'Límite de 5 reportes por día alcanzado'; end if;
  if p_unidad is not null then
    if not exists (select 1 from unidades where id = p_unidad and condominio_id = p_condominio) then raise exception 'Esa casa no existe'; end if;
    -- Señalar una casa en público crea roces: un reporte sobre una casa va solo a la junta.
    if p_visibilidad <> 'presidencia' then raise exception 'Un reporte sobre una casa solo puede ir a la junta'; end if;
  end if;
  insert into reportes (condominio_id, categoria, titulo, descripcion, ubicacion, anonimo, autor_id, visibilidad, unidad_id)
  values (p_condominio, p_categoria, p_titulo, p_descripcion, p_ubicacion, p_anonimo,
          case when p_anonimo then null else auth.uid() end, p_visibilidad, p_unidad)
  returning id into v_id;
  insert into reportes_autoria_privada (reporte_id, usuario_id) values (v_id, auth.uid());
  foreach f in array coalesce(p_fotos, '{}') loop
    insert into reporte_fotos (reporte_id, path) values (v_id, f);
  end loop;
  return v_id;
end $$;
grant execute on function crear_reporte(uuid, categoria_reporte, text, text, text, boolean, visibilidad_reporte, text[], uuid) to authenticated;

-- ---------- Avisos nuevos ----------
create or replace function usuarios_junta(p_condominio uuid) returns uuid[]
language sql stable security definer set search_path = public as $$
  select coalesce(array_agg(distinct usuario_id), '{}') from membresias
   where condominio_id = p_condominio and activo and rol in ('presidente', 'tesorero', 'vocal', 'administrador');
$$;
revoke all on function usuarios_junta(uuid) from public, anon, authenticated;

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso', 'difusion', 'cierre_mes', 'tasa_bcv', 'mensaje_anonimo', 'denuncia_anonima'));
