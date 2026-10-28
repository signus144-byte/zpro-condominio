-- =====================================================================
-- ZPro Condominio · 0000 Base propia (reemplaza lo que antes daba Supabase)
--
-- Roles de base de datos (sin inicio de sesión; el servidor los asume por petición):
--   anon           visitante sin sesión (solo verificar documentos)
--   authenticated  usuario con sesión; todas las tablas tienen seguridad por filas (RLS)
--   servicio       tareas programadas y procesos internos del servidor (salta RLS)
-- El servidor se conecta con un usuario propio (zpro_api) que es miembro de los tres.
-- En cada petición hace:  begin; set_config('app.uid', <usuario>); set local role authenticated; …; commit;
-- =====================================================================

do $$
begin
  if not exists (select from pg_roles where rolname = 'anon') then create role anon nologin; end if;
  if not exists (select from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
  if not exists (select from pg_roles where rolname = 'servicio') then create role servicio nologin bypassrls; end if;
end $$;

create extension if not exists citext;

-- ---------- Autenticación propia ----------
create schema if not exists auth;

-- Usuario en sesión (lo fija el servidor en cada petición). NULL si no hay sesión.
create or replace function auth.uid() returns uuid
language sql stable as $$
  select nullif(current_setting('app.uid', true), '')::uuid;
$$;

create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email citext not null unique check (email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  clave_hash text not null,                         -- argon2id
  correo_verificado_en timestamptz,
  creado_en timestamptz not null default now(),
  ultimo_ingreso_en timestamptz,
  intentos_fallidos smallint not null default 0,
  bloqueado_hasta timestamptz                      -- bloqueo temporal tras varios intentos fallidos
);

-- Sesiones: el "token de refresco" se guarda solo como hash. Cada uso lo rota.
create table auth.sesiones (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  refresco_hash text not null unique,
  creado_en timestamptz not null default now(),
  usado_en timestamptz not null default now(),
  expira_en timestamptz not null,
  revocada_en timestamptz,
  agente text,
  ip inet
);
create index on auth.sesiones (usuario_id);

-- Enlaces por correo: verificar correo y restablecer clave (solo hash del token).
create table auth.tokens_correo (
  id uuid primary key default gen_random_uuid(),
  usuario_id uuid not null references auth.users(id) on delete cascade,
  tipo text not null check (tipo in ('verificar', 'restablecer')),
  token_hash text not null unique,
  expira_en timestamptz not null,
  usado_en timestamptz,
  creado_en timestamptz not null default now()
);

-- Ningún rol de la app lee las tablas de autenticación: solo el servidor (zpro_api), fuera de la sesión.
revoke all on schema auth from public;
grant usage on schema auth to anon, authenticated, servicio;
grant execute on function auth.uid() to anon, authenticated, servicio;

-- ---------- Archivos (metadatos; el contenido va en disco o en Spaces) ----------
create schema if not exists storage;

create table storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false
);

create table storage.objects (
  id uuid primary key default gen_random_uuid(),
  bucket_id text not null references storage.buckets(id),
  name text not null,                               -- ruta dentro del bucket: <condominio>/<...>/<archivo>
  owner uuid,                                       -- quién lo subió (NULL en fotos de reportes anónimos)
  mime text,
  bytes integer,
  sha256 text,
  creado_en timestamptz not null default now(),
  unique (bucket_id, name)
);

create or replace function storage.foldername(name text) returns text[]
language sql immutable as $$
  select (string_to_array(name, '/'))[1:greatest(array_length(string_to_array(name, '/'), 1) - 1, 0)];
$$;

alter table storage.objects enable row level security;
grant usage on schema storage to anon, authenticated, servicio;
grant select, insert, update, delete on storage.objects to authenticated, servicio;
grant select on storage.buckets to authenticated, servicio;
grant execute on function storage.foldername(text) to anon, authenticated, servicio;

-- ---------- Permisos por defecto en el esquema de la app ----------
grant usage on schema public to anon, authenticated, servicio;
alter default privileges in schema public grant select, insert, update, delete on tables to authenticated, servicio;
alter default privileges in schema public grant usage, select on sequences to authenticated, servicio;
alter default privileges in schema public grant execute on functions to authenticated, servicio;
-- anon no recibe nada por defecto: solo lo que se le conceda expresamente (verificar_documento).
alter default privileges in schema public revoke execute on functions from public;
