-- =====================================================================
-- ZPro Condominio · 0011 Funciones que usa el servidor propio
-- =====================================================================

-- Mis solicitudes de ingreso pendientes (aún no soy miembro, así que no puedo leer el condominio por RLS).
create or replace function mis_solicitudes()
returns table (condominio_id uuid, condominio text, unidad text, rol rol_condominio, creado_en timestamptz)
language sql stable security definer set search_path = public as $$
  select s.condominio_id, c.nombre, case when u.id is null then null else etiqueta_unidad(u) end, s.rol, s.creado_en
    from solicitudes_ingreso s
    join condominios c on c.id = s.condominio_id
    left join unidades u on u.id = s.unidad_id
   where s.usuario_id = auth.uid() and s.estado = 'pendiente'
   order by s.creado_en;
$$;
