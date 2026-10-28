-- =====================================================================
-- ZPro Condominio · 0012 Funciones de apoyo para las rutas del condominio
-- (reportes anónimos: fotos y comentarios del autor sin revelar su identidad;
--  solicitudes de ingreso con el nombre del solicitante para la junta)
-- =====================================================================

-- ¿Puede el usuario en sesión ver este reporte? Mismas reglas que la política RLS de reportes,
-- más el autor privado de un reporte anónimo (que no figura en reportes.autor_id).
create or replace function puedo_ver_reporte(p_reporte uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from reportes r
     where r.id = p_reporte and (
       es_junta(r.condominio_id) or r.autor_id = auth.uid()
       or (r.visibilidad = 'comunidad' and es_miembro(r.condominio_id))
       or exists (select 1 from reportes_autoria_privada a where a.reporte_id = r.id and a.usuario_id = auth.uid())));
$$;

-- Fotos de los reportes que el usuario puede ver en un condominio (incluye sus reportes anónimos).
create or replace function reporte_fotos_visibles(p_condominio uuid)
returns table (reporte_id uuid, path text)
language sql stable security definer set search_path = public as $$
  select f.reporte_id, f.path
    from reporte_fotos f join reportes r on r.id = f.reporte_id
   where r.condominio_id = p_condominio and puedo_ver_reporte(r.id)
   order by f.path;
$$;

-- Comentarios de un reporte. El autor anónimo comenta sin nombre ("Autor del reporte").
create or replace function comentarios_reporte(p_reporte uuid)
returns table (id uuid, autor text, es_oficial boolean, texto text, creado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not puedo_ver_reporte(p_reporte) then raise exception 'Sin permiso'; end if;
  return query
    select c.id, case when c.autor_id is null then 'Autor del reporte' else p.nombre end, c.es_oficial, c.texto, c.creado_en
      from reporte_comentarios c left join perfiles p on p.id = c.autor_id
     where c.reporte_id = p_reporte order by c.creado_en;
end $$;

create or replace function comentar_reporte(p_reporte uuid, p_texto text, p_oficial boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare r reportes; v_autor uuid := auth.uid(); v_id uuid;
begin
  select * into r from reportes where id = p_reporte;
  if not found or not puedo_ver_reporte(p_reporte) then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_texto), '') = '' then raise exception 'Escriba un comentario'; end if;
  if p_oficial and not es_junta(r.condominio_id) then raise exception 'Sin permiso'; end if;
  -- Si quien comenta es el autor privado de un reporte anónimo, el comentario también va sin nombre.
  if not p_oficial and r.anonimo and exists (
       select 1 from reportes_autoria_privada a where a.reporte_id = r.id and a.usuario_id = auth.uid()) then
    v_autor := null;
  end if;
  insert into reporte_comentarios (reporte_id, autor_id, es_oficial, texto)
  values (p_reporte, v_autor, p_oficial, left(p_texto, 2000)) returning id into v_id;
  return v_id;
end $$;

-- Solicitudes de ingreso pendientes con el nombre del solicitante (aún no es miembro: su perfil
-- no es visible por RLS). Solo la junta.
create or replace function solicitudes_pendientes(p_condominio uuid)
returns table (id uuid, usuario_nombre text, unidad_id uuid, unidad text, rol rol_condominio, creado_en timestamptz)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_junta(p_condominio) then raise exception 'Sin permiso'; end if;
  return query
    select s.id, p.nombre, s.unidad_id, case when u.id is null then null else etiqueta_unidad(u) end, s.rol, s.creado_en
      from solicitudes_ingreso s join perfiles p on p.id = s.usuario_id
      left join unidades u on u.id = s.unidad_id
     where s.condominio_id = p_condominio and s.estado = 'pendiente'
     order by s.creado_en;
end $$;

-- Corrección: la política de perfiles consultaba membresias, que a su vez tiene RLS (cada residente solo ve
-- su propia membresía), así que un vecino nunca veía el nombre de otro (p. ej. el autor de un reporte público).
-- Se reemplaza por una función que mira las membresías sin RLS.
create or replace function comparte_condominio(p_usuario uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias a join membresias b on a.condominio_id = b.condominio_id
                  where a.usuario_id = auth.uid() and a.activo and b.usuario_id = p_usuario);
$$;
drop policy if exists ver on perfiles;
create policy ver on perfiles for select using (id = auth.uid() or comparte_condominio(id));
