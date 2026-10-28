-- =====================================================================
-- ZPro Condominio · 0011 Funciones de la consola master (soporte, equipo, tasa)
-- Soporte ve lo mínimo para ayudar: nombre, correo, condominio y rol.
-- Nunca chats, pagos de residentes, saldos individuales ni autoría de reportes.
-- =====================================================================
-- 1) Buscar usuarios por nombre, correo o condominio (soporte telefónico).
create or replace function soporte_buscar_usuarios(p_texto text)
returns table (usuario_id uuid, nombre text, correo text, condominios jsonb)
language plpgsql stable security definer set search_path = public, auth as $$
begin
  if not es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  if length(trim(p_texto)) < 2 then return; end if;
  return query
    select p.id, p.nombre, u.email::text,
           coalesce(jsonb_agg(jsonb_build_object('nombre', c.nombre, 'rol', m.rol,
                    'unidad', case when un.id is null then null else etiqueta_unidad(un) end))
                    filter (where m.id is not null), '[]'::jsonb)
      from perfiles p
      join auth.users u on u.id = p.id
      left join membresias m on m.usuario_id = p.id and m.activo
      left join condominios c on c.id = m.condominio_id
      left join unidades un on un.id = m.unidad_id
     where p.nombre ilike '%' || p_texto || '%' or u.email ilike '%' || p_texto || '%' or c.nombre ilike '%' || p_texto || '%'
     group by p.id, p.nombre, u.email
     limit 50;
end $$;

-- 2) Solicitudes de ingreso pendientes de todos los condominios (para avisar a la junta que las apruebe).
create or replace function soporte_solicitudes_pendientes()
returns table (id uuid, condominio_id uuid, condominio text, usuario text, unidad text, rol rol_condominio, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select s.id, s.condominio_id, c.nombre, p.nombre, case when u.id is null then null else etiqueta_unidad(u) end, s.rol, s.creado_en
    from solicitudes_ingreso s
    join condominios c on c.id = s.condominio_id
    join perfiles p on p.id = s.usuario_id
    left join unidades u on u.id = s.unidad_id
   where s.estado = 'pendiente' and es_admin_plataforma(array['dueno','soporte']::rol_plataforma[])
   order by s.creado_en;
$$;

-- 3) Equipo de ZentaPro con nombre y correo.
create or replace function equipo_plataforma()
returns table (usuario_id uuid, nombre text, correo text, rol rol_plataforma, activo boolean)
language sql stable security definer set search_path = public, auth as $$
  select a.usuario_id, p.nombre, u.email::text, a.rol, a.activo
    from plataforma_admins a join perfiles p on p.id = a.usuario_id join auth.users u on u.id = a.usuario_id
   where es_admin_plataforma()
   order by a.rol, p.nombre;
$$;

-- 4) Agregar a alguien del equipo por correo (debe haberse registrado antes).
create or replace function agregar_admin_plataforma(p_correo text, p_rol rol_plataforma)
returns void language plpgsql security definer set search_path = public, auth as $$
declare v uuid;
begin
  if not es_admin_plataforma(array['dueno']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  select id into v from auth.users where lower(email) = lower(trim(p_correo));
  if v is null then raise exception 'Ese correo no tiene cuenta. Pídale que se registre primero.'; end if;
  insert into plataforma_admins (usuario_id, rol) values (v, p_rol)
  on conflict (usuario_id) do update set rol = excluded.rol, activo = true;
end $$;

-- 5) Cargar la tasa BCV del día desde la consola (la política actual solo deja a juntas).
create or replace function plataforma_fijar_tasa_bcv(p_usd_ves numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  if p_usd_ves <= 0 then raise exception 'Tasa no válida'; end if;
  insert into tasas_bcv (fecha, usd_ves, fuente) values (current_date, p_usd_ves, 'manual consola')
  on conflict (fecha) do update set usd_ves = excluded.usd_ves, fuente = excluded.fuente;
end $$;
