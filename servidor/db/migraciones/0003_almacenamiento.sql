-- =====================================================================
-- ZPro Condominio · Archivos (permisos en storage.objects; los bytes los guarda el servidor). Todos los buckets son privados.
-- Rutas:
--   comprobantes/<condominio_id>/<usuario_id>/<archivo>   captura del pago
--   facturas/<condominio_id>/<gasto_id>.<ext>              factura del gasto (visible a todos los miembros)
--   reportes/<condominio_id>/<uuid aleatorio>/<n>.jpg      fotos de irregularidades
--
-- IMPORTANTE (reportes anónimos): storage.objects.owner guarda quién subió cada archivo.
-- Para que un reporte anónimo no se pueda rastrear por sus fotos, el servidor las
-- re-codifica (sin EXIF/GPS) y las guarda con owner = NULL (servidor/src/rutas/reportes.ts).
-- =====================================================================

insert into storage.buckets (id, name, public) values
  ('comprobantes', 'comprobantes', false),
  ('facturas', 'facturas', false),
  ('reportes', 'reportes', false)
on conflict (id) do nothing;

create policy comprobantes_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'comprobantes'
  and (storage.foldername(name))[2] = auth.uid()::text
  and es_miembro(((storage.foldername(name))[1])::uuid));

create policy comprobantes_ver on storage.objects for select to authenticated using (
  bucket_id = 'comprobantes' and (
    (storage.foldername(name))[2] = auth.uid()::text
    or maneja_finanzas(((storage.foldername(name))[1])::uuid)));

create policy facturas_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'facturas' and maneja_finanzas(((storage.foldername(name))[1])::uuid));

create policy facturas_ver on storage.objects for select to authenticated using (
  bucket_id = 'facturas' and es_miembro(((storage.foldername(name))[1])::uuid));

-- Fotos de reportes: la junta ve todas; los vecinos solo las de reportes publicados a la comunidad.
create policy reportes_ver on storage.objects for select to authenticated using (
  bucket_id = 'reportes' and (
    es_junta(((storage.foldername(name))[1])::uuid)
    or exists (select 1 from public.reporte_fotos f join public.reportes r on r.id = f.reporte_id
                where f.path = storage.objects.name and r.visibilidad = 'comunidad')));

-- Reportes con nombre: el residente puede subir sus fotos directo.
create policy reportes_subir on storage.objects for insert to authenticated with check (
  bucket_id = 'reportes' and es_miembro(((storage.foldername(name))[1])::uuid));
