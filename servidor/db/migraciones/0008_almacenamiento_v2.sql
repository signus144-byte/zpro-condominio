-- =====================================================================
-- ZPro Condominio · 0008 Archivos del chat, marca y documentos (permisos en storage.objects)
--   chat/<condominio>/<conversacion>/<id>.<ext>   se borran a los N días (purgar-adjuntos)
--   marca/<condominio>/logo.png | entrada.jpg      logo y foto de la fachada/portón (lectura para miembros)
--   documentos/<condominio>/<id>.<pdf|xlsx>         documentos emitidos que se guardan (actas firmadas, etc.)
-- =====================================================================
insert into storage.buckets (id, name, public) values
  ('chat', 'chat', false), ('marca', 'marca', false), ('documentos', 'documentos', false)
on conflict (id) do nothing;

create policy chat_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'chat' and puedo_ver_conversacion(((storage.foldername(name))[2])::uuid));
create policy chat_ver on storage.objects for select to authenticated using (
  bucket_id = 'chat' and puedo_ver_conversacion(((storage.foldername(name))[2])::uuid));

create policy marca_ver on storage.objects for select to authenticated using (
  bucket_id = 'marca' and (es_miembro(((storage.foldername(name))[1])::uuid) or es_admin_plataforma()));
create policy marca_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'marca' and (tiene_rol(((storage.foldername(name))[1])::uuid, array['presidente','administrador']::rol_condominio[])
                           or es_admin_plataforma(array['dueno','soporte']::rol_plataforma[])));
create policy marca_reemplazar on storage.objects for update to authenticated using (
  bucket_id = 'marca' and (tiene_rol(((storage.foldername(name))[1])::uuid, array['presidente','administrador']::rol_condominio[])
                           or es_admin_plataforma(array['dueno','soporte']::rol_plataforma[])));

create policy documentos_ver on storage.objects for select to authenticated using (
  bucket_id = 'documentos' and es_junta(((storage.foldername(name))[1])::uuid));
create policy documentos_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'documentos' and es_junta(((storage.foldername(name))[1])::uuid));
