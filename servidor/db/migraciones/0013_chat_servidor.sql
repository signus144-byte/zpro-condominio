-- =====================================================================
-- ZPro Condominio · 0013 Funciones del chat que usa el servidor propio (tiempo real)
-- =====================================================================

-- Personas que pueden ver una conversación (para avisar "hay algo nuevo" a quien esté conectado).
-- Solo la usa el hub de tiempo real con el rol servicio.
create or replace function participantes_conversacion(p_conv uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct mb.usuario_id
    from conversaciones c
    join membresias mb on mb.condominio_id = c.condominio_id and mb.activo
   where c.id = p_conv
     and (c.tipo = 'canal'
          or exists (select 1 from conversacion_partes p
                      where p.conversacion_id = c.id
                        and ((p.es_junta and mb.rol in ('presidente','tesorero','vocal','administrador'))
                             or p.unidad_id = mb.unidad_id)));
$$;
revoke all on function participantes_conversacion(uuid) from public, authenticated, anon;
grant execute on function participantes_conversacion(uuid) to servicio;

-- Usuarios de una casa (para avisar el cambio de estado de un pago).
create or replace function usuarios_de_unidad(p_unidad uuid)
returns setof uuid language sql stable security definer set search_path = public as $$
  select distinct usuario_id from membresias where unidad_id = p_unidad and activo;
$$;
revoke all on function usuarios_de_unidad(uuid) from public, authenticated, anon;
grant execute on function usuarios_de_unidad(uuid) to servicio;

-- Eliminar un mensaje de solo texto lo deja sin texto: el CHECK original lo impedía.
do $$
declare n text;
begin
  select conname into n from pg_constraint
   where conrelid = 'public.mensajes'::regclass and contype = 'c'
     and pg_get_constraintdef(oid) like '%adjunto_id IS NOT NULL%';
  if n is not null then execute format('alter table public.mensajes drop constraint %I', n); end if;
end $$;
alter table mensajes add constraint mensajes_contenido_check
  check (eliminado_en is not null or texto is not null or adjunto_id is not null or tipo = 'sistema');

-- Nombre visible de una persona para quien comparte condominio con ella (o para el servidor).
-- La política de perfiles no alcanza: la tabla membresias tiene su propio RLS y oculta a los vecinos.
create or replace function nombre_visible(p_usuario uuid) returns text
language sql stable security definer set search_path = public as $$
  select p.nombre from perfiles p
   where p.id = p_usuario
     and (es_servicio() or p_usuario = auth.uid() or exists (
           select 1 from membresias a join membresias b on a.condominio_id = b.condominio_id
            where a.usuario_id = auth.uid() and a.activo and b.usuario_id = p_usuario));
$$;
