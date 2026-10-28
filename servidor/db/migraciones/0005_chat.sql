-- =====================================================================
-- ZPro Condominio · 0005 Chat (tipo WhatsApp)
--
-- Quién habla con quién: las "partes" de una conversación son CASAS
-- (unidades) o LA JUNTA. Todos los miembros de una casa comparten su
-- bandeja; todos los miembros de la junta comparten la de la junta.
-- Se muestra como "Casa 28 · Elena Castro" o "Junta de condominio · María".
--
--   directa  casa ↔ casa              (vecino a vecino, con nombre: NO anónimo)
--   junta    casa ↔ junta             (residente ↔ Presidencia, en ambos sentidos)
--   grupo    varias casas (+ junta)   (salas: "Bloque B", "Comisión de pintura")
--   canal    junta → todas las casas  (avisos; solo la junta escribe)
--
-- Archivos: se guardan en el servidor N días (según el plan) y luego se borran.
-- Cada teléfono guarda su copia al recibirlos (constancia local en el dispositivo).
-- El texto se conserva en el servidor según retencion_mensajes_meses del condominio.
-- No hay anonimato en el chat; lo único anónimo son los reportes (0001/0002).
-- =====================================================================

create type tipo_conversacion as enum ('directa', 'junta', 'grupo', 'canal');
create type tipo_mensaje as enum ('texto', 'imagen', 'archivo', 'audio', 'documento_emitido', 'sistema');

create table conversaciones (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  tipo tipo_conversacion not null,
  titulo text,                                   -- grupos y canales
  solo_junta_escribe boolean not null default false,
  clave_unica text,                              -- evita duplicar la conversación directa/junta
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now(),
  ultimo_mensaje_en timestamptz,
  archivada boolean not null default false,
  unique (condominio_id, clave_unica)
);

create table conversacion_partes (
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  unidad_id uuid references unidades(id) on delete cascade,
  es_junta boolean not null default false,
  check ((unidad_id is null) = es_junta),
  unique (conversacion_id, unidad_id),
  unique nulls not distinct (conversacion_id, es_junta, unidad_id)
);

create table adjuntos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  path text not null unique,                     -- storage: chat/<condominio>/<conversacion>/<id>.<ext>
  nombre text not null,
  mime text not null,
  bytes integer not null check (bytes > 0 and bytes <= 25 * 1024 * 1024),  -- máx. 25 MB
  sha256 text,                                   -- huella para comprobar la copia local
  subido_por uuid references perfiles(id),
  creado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  eliminado_en timestamptz                       -- se llena al purgar del servidor
);

create table mensajes (
  id uuid primary key default gen_random_uuid(),
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  condominio_id uuid not null references condominios(id) on delete cascade,
  autor_id uuid references perfiles(id),
  autor_unidad_id uuid references unidades(id),  -- "desde qué casa" escribe
  como_junta boolean not null default false,     -- escribe en nombre de la junta
  tipo tipo_mensaje not null default 'texto',
  texto text check (char_length(texto) <= 4000),
  adjunto_id uuid references adjuntos(id) on delete set null,
  responde_a uuid references mensajes(id) on delete set null,
  creado_en timestamptz not null default now(),
  editado_en timestamptz,
  eliminado_en timestamptz,                      -- "Se eliminó este mensaje"
  check (texto is not null or adjunto_id is not null or tipo = 'sistema'),
  check (not como_junta or autor_unidad_id is null)
);
create index on mensajes (conversacion_id, creado_en desc);
create index on mensajes (condominio_id, creado_en);

-- Lecturas: un puntero por persona y conversación (como los ✓✓ de WhatsApp, sin una fila por mensaje).
create table conversacion_lecturas (
  conversacion_id uuid not null references conversaciones(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  entregado_hasta timestamptz,
  leido_hasta timestamptz,
  silenciada boolean not null default false,
  primary key (conversacion_id, usuario_id)
);

create table bloqueos_chat (
  unidad_id uuid not null references unidades(id) on delete cascade,      -- quien bloquea
  bloqueada_id uuid not null references unidades(id) on delete cascade,   -- a quién
  creado_en timestamptz not null default now(),
  primary key (unidad_id, bloqueada_id)
);

create table denuncias_mensaje (
  id uuid primary key default gen_random_uuid(),
  mensaje_id uuid not null references mensajes(id) on delete cascade,
  condominio_id uuid not null references condominios(id) on delete cascade,
  denunciado_por uuid not null references perfiles(id),
  motivo text not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','atendida','descartada')),
  creado_en timestamptz not null default now(),
  unique (mensaje_id, denunciado_por)
);

-- Dispositivos para notificaciones push (Firebase Cloud Messaging).
create table dispositivos (
  token text primary key,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  plataforma text not null check (plataforma in ('android','ios','web')),
  actualizado_en timestamptz not null default now()
);

-- ---------- Permisos ----------
create or replace function mis_unidades() returns setof uuid
language sql stable security definer set search_path = public as $$
  select unidad_id from membresias where usuario_id = auth.uid() and activo and unidad_id is not null;
$$;

create or replace function puedo_ver_conversacion(p_conv uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from conversaciones c
     where c.id = p_conv and (
       c.tipo = 'canal' and es_miembro(c.condominio_id)
       or exists (select 1 from conversacion_partes p where p.conversacion_id = c.id
                    and ((p.es_junta and es_junta(c.condominio_id)) or p.unidad_id in (select mis_unidades())))));
$$;

-- ¿Puedo escribir? Además de verla: canal/solo_junta → solo la junta; directa bloqueada → no.
create or replace function puedo_escribir(p_conv uuid, p_unidad uuid, p_como_junta boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c conversaciones;
begin
  select * into c from conversaciones where id = p_conv;
  if not found or c.archivada or not condominio_operativo(c.condominio_id) then return false; end if;
  if p_como_junta then
    return es_junta(c.condominio_id) and exists (select 1 from conversacion_partes where conversacion_id = p_conv and es_junta)
           or (c.tipo = 'canal' and es_junta(c.condominio_id));
  end if;
  if c.tipo = 'canal' or c.solo_junta_escribe then return false; end if;
  if p_unidad is null or p_unidad not in (select mis_unidades()) then return false; end if;
  if not exists (select 1 from conversacion_partes where conversacion_id = p_conv and unidad_id = p_unidad) then return false; end if;
  -- Si la otra casa me bloqueó, no puedo escribirle por directo.
  if c.tipo = 'directa' and exists (
       select 1 from conversacion_partes o join bloqueos_chat b on b.unidad_id = o.unidad_id and b.bloqueada_id = p_unidad
        where o.conversacion_id = p_conv and o.unidad_id <> p_unidad) then
    return false;
  end if;
  return true;
end $$;

-- ---------- Abrir conversaciones (idempotente: si existe, la devuelve) ----------
create or replace function abrir_directa(p_mi_unidad uuid, p_otra_unidad uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_condo uuid; v_clave text; v_id uuid;
begin
  if p_mi_unidad not in (select mis_unidades()) then raise exception 'Esa no es su unidad'; end if;
  if p_mi_unidad = p_otra_unidad then raise exception 'No puede escribirse a sí mismo'; end if;
  select condominio_id into v_condo from unidades where id = p_mi_unidad;
  if not exists (select 1 from unidades where id = p_otra_unidad and condominio_id = v_condo) then
    raise exception 'Esa casa no pertenece a su condominio';
  end if;
  v_clave := 'd:' || least(p_mi_unidad, p_otra_unidad) || ':' || greatest(p_mi_unidad, p_otra_unidad);
  select id into v_id from conversaciones where condominio_id = v_condo and clave_unica = v_clave;
  if v_id is null then
    insert into conversaciones (condominio_id, tipo, clave_unica, creado_por)
    values (v_condo, 'directa', v_clave, auth.uid()) returning id into v_id;
    insert into conversacion_partes (conversacion_id, unidad_id) values (v_id, p_mi_unidad), (v_id, p_otra_unidad);
  end if;
  return v_id;
end $$;

-- Conversación casa ↔ junta. La abre el residente (con su unidad) o la junta (con la unidad destino).
create or replace function abrir_con_junta(p_unidad uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_condo uuid; v_clave text; v_id uuid;
begin
  select condominio_id into v_condo from unidades where id = p_unidad;
  if v_condo is null then raise exception 'Unidad no existe'; end if;
  if not (p_unidad in (select mis_unidades()) or es_junta(v_condo)) then raise exception 'Sin permiso'; end if;
  v_clave := 'j:' || p_unidad;
  select id into v_id from conversaciones where condominio_id = v_condo and clave_unica = v_clave;
  if v_id is null then
    insert into conversaciones (condominio_id, tipo, clave_unica, creado_por)
    values (v_condo, 'junta', v_clave, auth.uid()) returning id into v_id;
    insert into conversacion_partes (conversacion_id, unidad_id, es_junta) values (v_id, p_unidad, false), (v_id, null, true);
  end if;
  return v_id;
end $$;

-- Grupo o canal: solo la junta los crea.
create or replace function crear_sala(p_condominio uuid, p_tipo tipo_conversacion, p_titulo text,
                                      p_unidades uuid[], p_solo_junta boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; u uuid;
begin
  if not es_junta(p_condominio) then raise exception 'Solo la junta crea salas'; end if;
  if p_tipo not in ('grupo','canal') then raise exception 'Tipo inválido'; end if;
  insert into conversaciones (condominio_id, tipo, titulo, solo_junta_escribe, creado_por)
  values (p_condominio, p_tipo, p_titulo, p_tipo = 'canal' or p_solo_junta, auth.uid()) returning id into v_id;
  insert into conversacion_partes (conversacion_id, unidad_id, es_junta) values (v_id, null, true);
  if p_tipo = 'grupo' then
    foreach u in array coalesce(p_unidades, '{}') loop
      insert into conversacion_partes (conversacion_id, unidad_id)
      select v_id, id from unidades where id = u and condominio_id = p_condominio;
    end loop;
  end if;
  return v_id;
end $$;

-- Registra un adjunto ya subido a storage y fija su vencimiento según el plan/condominio.
create or replace function registrar_adjunto(p_conv uuid, p_path text, p_nombre text, p_mime text, p_bytes integer, p_sha256 text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c conversaciones; dias smallint; v_id uuid;
begin
  if not puedo_ver_conversacion(p_conv) then raise exception 'Sin permiso'; end if;
  select * into c from conversaciones where id = p_conv;
  if p_path not like c.condominio_id || '/' || c.id || '/%' then raise exception 'Ruta de archivo inválida'; end if;
  select retencion_adjuntos_dias into dias from condominios where id = c.condominio_id;
  insert into adjuntos (condominio_id, conversacion_id, path, nombre, mime, bytes, sha256, subido_por, expira_en)
  values (c.condominio_id, p_conv, p_path, p_nombre, p_mime, p_bytes, p_sha256, auth.uid(), now() + make_interval(days => dias))
  returning id into v_id;
  return v_id;
end $$;

create or replace function mensajes_antes_de_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.autor_id := auth.uid();
  select condominio_id into new.condominio_id from conversaciones where id = new.conversacion_id;
  if new.tipo = 'sistema' then raise exception 'Mensajes de sistema solo desde el servidor'; end if;
  if new.adjunto_id is not null and not exists (
       select 1 from adjuntos a where a.id = new.adjunto_id and a.conversacion_id = new.conversacion_id) then
    raise exception 'Adjunto inválido';
  end if;
  return new;
end $$;
create trigger mensajes_bi before insert on mensajes for each row execute function mensajes_antes_de_insertar();

create or replace function mensajes_despues_de_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update conversaciones set ultimo_mensaje_en = new.creado_en where id = new.conversacion_id;
  return null;
end $$;
create trigger mensajes_ai after insert on mensajes for each row execute function mensajes_despues_de_insertar();

-- El autor puede editar (15 min) o borrar su mensaje; no se puede cambiar nada más.
create or replace function mensajes_antes_de_actualizar() returns trigger
language plpgsql set search_path = public as $$
begin
  if old.autor_id is distinct from auth.uid() then raise exception 'Solo el autor modifica su mensaje'; end if;
  if new.conversacion_id <> old.conversacion_id or new.autor_id is distinct from old.autor_id
     or new.autor_unidad_id is distinct from old.autor_unidad_id or new.como_junta <> old.como_junta
     or new.creado_en <> old.creado_en or new.adjunto_id is distinct from old.adjunto_id then
    raise exception 'Cambio no permitido';
  end if;
  if new.texto is distinct from old.texto then
    if now() - old.creado_en > interval '15 minutes' then raise exception 'Solo se puede editar durante 15 minutos'; end if;
    new.editado_en := now();
  end if;
  if new.eliminado_en is not null and old.eliminado_en is null then new.texto := null; new.eliminado_en := now(); end if;
  return new;
end $$;
create trigger mensajes_bu before update on mensajes for each row execute function mensajes_antes_de_actualizar();

create or replace function marcar_leido(p_conv uuid, p_hasta timestamptz default now())
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puedo_ver_conversacion(p_conv) then raise exception 'Sin permiso'; end if;
  insert into conversacion_lecturas (conversacion_id, usuario_id, entregado_hasta, leido_hasta)
  values (p_conv, auth.uid(), p_hasta, p_hasta)
  on conflict (conversacion_id, usuario_id) do update
    set leido_hasta = greatest(conversacion_lecturas.leido_hasta, excluded.leido_hasta),
        entregado_hasta = greatest(conversacion_lecturas.entregado_hasta, excluded.entregado_hasta);
end $$;

-- Estado de un mensaje para su autor: 1 = enviado, 2 = entregado a todos, 3 = leído por todos.
-- "Todos" = al menos una persona de cada casa/junta destinataria (como en un grupo de WhatsApp).
create or replace function estado_mensaje(p_mensaje uuid) returns smallint
language plpgsql stable security definer set search_path = public as $$
declare m mensajes; partes_total integer; entregadas integer; leidas integer;
begin
  select * into m from mensajes where id = p_mensaje;
  if m.autor_id is distinct from auth.uid() then return null; end if;
  with destinos as (
    select p.unidad_id, p.es_junta from conversacion_partes p
     where p.conversacion_id = m.conversacion_id
       and not (p.es_junta and m.como_junta) and p.unidad_id is distinct from m.autor_unidad_id),
  por_parte as (
    select d.unidad_id, d.es_junta,
           bool_or(l.entregado_hasta >= m.creado_en) as entregado, bool_or(l.leido_hasta >= m.creado_en) as leido
      from destinos d
      join membresias mb on mb.activo and mb.condominio_id = m.condominio_id
        and ((d.es_junta and mb.rol in ('presidente','tesorero','vocal','administrador')) or mb.unidad_id = d.unidad_id)
      left join conversacion_lecturas l on l.conversacion_id = m.conversacion_id and l.usuario_id = mb.usuario_id
     group by d.unidad_id, d.es_junta)
  select count(*), count(*) filter (where entregado), count(*) filter (where leido)
    into partes_total, entregadas, leidas from por_parte;
  if partes_total > 0 and leidas = partes_total then return 3; end if;
  if partes_total > 0 and entregadas = partes_total then return 2; end if;
  return 1;
end $$;

-- ---------- Retención (la llama un proceso programado cada noche) ----------
-- Devuelve las rutas a borrar de storage; la función de servidor `purgar-adjuntos` las elimina.
create or replace function purgar_adjuntos_vencidos(p_limite integer default 1000)
returns table (path text) language plpgsql security definer set search_path = public as $$
begin
  return query
    update adjuntos a set eliminado_en = now()
     where a.id in (select id from adjuntos where eliminado_en is null and expira_en < now() limit p_limite)
    returning a.path;
end $$;

create or replace function purgar_mensajes_antiguos()
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  with b as (
    delete from mensajes m using condominios c
     where c.id = m.condominio_id and m.creado_en < now() - make_interval(months => c.retencion_mensajes_meses)
    returning 1)
  select count(*) into n from b;
  return n;
end $$;
revoke all on function purgar_adjuntos_vencidos(integer), purgar_mensajes_antiguos() from public, authenticated, anon;
grant execute on function purgar_adjuntos_vencidos(integer), purgar_mensajes_antiguos() to servicio;

-- ---------- RLS ----------
alter table conversaciones enable row level security;
alter table conversacion_partes enable row level security;
alter table adjuntos enable row level security;
alter table mensajes enable row level security;
alter table conversacion_lecturas enable row level security;
alter table bloqueos_chat enable row level security;
alter table denuncias_mensaje enable row level security;
alter table dispositivos enable row level security;

create policy ver on conversaciones for select using (puedo_ver_conversacion(id));
create policy junta_editar on conversaciones for update using (es_junta(condominio_id) and tipo in ('grupo','canal'));
create policy ver on conversacion_partes for select using (puedo_ver_conversacion(conversacion_id));
create policy ver on adjuntos for select using (puedo_ver_conversacion(conversacion_id));
create policy ver on mensajes for select using (puedo_ver_conversacion(conversacion_id));
create policy escribir on mensajes for insert with check (puedo_escribir(conversacion_id, autor_unidad_id, como_junta));
create policy editar_propio on mensajes for update using (autor_id = auth.uid());
create policy propias on conversacion_lecturas for select using (usuario_id = auth.uid() or puedo_ver_conversacion(conversacion_id));
create policy propias_silenciar on conversacion_lecturas for update using (usuario_id = auth.uid());
create policy mis_bloqueos on bloqueos_chat for all using (unidad_id in (select mis_unidades()))
  with check (unidad_id in (select mis_unidades()));
-- Quien denuncia ve su denuncia; la junta ve la denuncia y (solo entonces) el mensaje denunciado.
create policy ver on denuncias_mensaje for select using (denunciado_por = auth.uid() or es_junta(condominio_id));
create policy denunciar on denuncias_mensaje for insert with check (
  denunciado_por = auth.uid() and exists (select 1 from mensajes m where m.id = mensaje_id and puedo_ver_conversacion(m.conversacion_id)));
create policy atender on denuncias_mensaje for update using (es_junta(condominio_id));
create policy mis_dispositivos on dispositivos for all using (usuario_id = auth.uid()) with check (usuario_id = auth.uid());

-- La junta puede leer el mensaje denunciado aunque sea de una conversación entre vecinos.
create or replace function mensaje_denunciado(p_denuncia uuid)
returns table (texto text, autor text, casa text, creado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
declare d denuncias_mensaje;
begin
  select * into d from denuncias_mensaje where id = p_denuncia;
  if not found or not es_junta(d.condominio_id) then raise exception 'Sin permiso'; end if;
  return query select m.texto, p.nombre, etiqueta_unidad(u), m.creado_en
                 from mensajes m left join perfiles p on p.id = m.autor_id left join unidades u on u.id = m.autor_unidad_id
                where m.id = d.mensaje_id;
end $$;

-- Tokens push de quienes deben recibir aviso de un mensaje (menos el autor y quienes silenciaron).
-- Solo la usa la función de servidor `notificar`.
create or replace function destinatarios_push(p_mensaje uuid)
returns table (token text) language sql stable security definer set search_path = public as $$
  with m as (select * from mensajes where id = p_mensaje),
  partes as (
    select p.* from conversacion_partes p, m where p.conversacion_id = m.conversacion_id
    union all   -- canal: todas las casas del condominio
    select c.id, u.id, false from m join conversaciones c on c.id = m.conversacion_id and c.tipo = 'canal'
      join unidades u on u.condominio_id = c.condominio_id),
  personas as (
    select distinct mb.usuario_id from partes pa, m
      join membresias mb on mb.condominio_id = m.condominio_id and mb.activo
     where (pa.es_junta and mb.rol in ('presidente','tesorero','vocal','administrador')) or mb.unidad_id = pa.unidad_id)
  select d.token from personas pe
    join dispositivos d on d.usuario_id = pe.usuario_id, m
   where pe.usuario_id is distinct from m.autor_id
     and not exists (select 1 from conversacion_lecturas l
                      where l.conversacion_id = m.conversacion_id and l.usuario_id = pe.usuario_id and l.silenciada);
$$;
revoke all on function destinatarios_push(uuid) from public, authenticated, anon;
grant execute on function destinatarios_push(uuid) to servicio;

-- Bandeja de chats en UNA consulta (para escala: evita 2 consultas por conversación).
-- Título según quien mira: casa ↔ casa muestra la otra casa; casa ↔ junta muestra la casa a la junta
-- y "Junta de condominio" al residente.
create or replace function bandeja(p_condominio uuid)
returns table (id uuid, tipo tipo_conversacion, titulo text, ultimo_texto text, ultimo_autor_soy_yo boolean,
               ultimo_en timestamptz, no_leidos integer, silenciada boolean, solo_junta_escribe boolean)
language sql stable security definer set search_path = public as $$
  with yo as (select es_junta(p_condominio) as junta),
  visibles as (
    select c.* from conversaciones c
     where c.condominio_id = p_condominio and not c.archivada and puedo_ver_conversacion(c.id))
  select v.id, v.tipo,
    case
      when v.tipo in ('grupo','canal') then v.titulo
      when v.tipo = 'junta' and not (select junta from yo) then 'Junta de condominio'
      else (select etiqueta_unidad(u) from conversacion_partes p join unidades u on u.id = p.unidad_id
             where p.conversacion_id = v.id and p.unidad_id not in (select mis_unidades()) limit 1)
    end,
    (select coalesce(case when m.eliminado_en is not null then 'Se eliminó este mensaje' end, m.texto, a.nombre)
       from mensajes m left join adjuntos a on a.id = m.adjunto_id
      where m.conversacion_id = v.id order by m.creado_en desc limit 1),
    (select m.autor_id = auth.uid() from mensajes m where m.conversacion_id = v.id order by m.creado_en desc limit 1),
    v.ultimo_mensaje_en,
    (select count(*)::int from mensajes m
      where m.conversacion_id = v.id and m.autor_id is distinct from auth.uid()
        and m.creado_en > coalesce((select l.leido_hasta from conversacion_lecturas l
                                     where l.conversacion_id = v.id and l.usuario_id = auth.uid()), '-infinity')),
    coalesce((select l.silenciada from conversacion_lecturas l where l.conversacion_id = v.id and l.usuario_id = auth.uid()), false),
    v.solo_junta_escribe
  from visibles v
  order by v.ultimo_mensaje_en desc nulls last;
$$;

-- Estado de chat del usuario (para pintar el menú): casas que bloqueé y conversaciones silenciadas.
create or replace function mi_estado_chat(p_condominio uuid)
returns table (bloqueadas uuid[], silenciadas uuid[])
language sql stable security definer set search_path = public as $$
  select
    coalesce((select array_agg(b.bloqueada_id) from bloqueos_chat b where b.unidad_id in (select mis_unidades())), '{}'),
    coalesce((select array_agg(l.conversacion_id) from conversacion_lecturas l
               join conversaciones c on c.id = l.conversacion_id
              where l.usuario_id = auth.uid() and l.silenciada and c.condominio_id = p_condominio), '{}');
$$;

create or replace function silenciar_conversacion(p_conv uuid, p_silenciar boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not puedo_ver_conversacion(p_conv) then raise exception 'Sin permiso'; end if;
  insert into conversacion_lecturas (conversacion_id, usuario_id, silenciada) values (p_conv, auth.uid(), p_silenciar)
  on conflict (conversacion_id, usuario_id) do update set silenciada = excluded.silenciada;
end $$;
