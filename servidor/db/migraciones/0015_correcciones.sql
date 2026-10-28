-- =====================================================================
-- ZPro Condominio · 0015 Correcciones detectadas en la prueba de punta a punta
-- =====================================================================

-- La junta (finanzas) puede corregir la tasa BCV del día si ya estaba cargada
-- (antes solo podía insertarla: "on conflict do update" fallaba por falta de política de UPDATE).
create policy corregir on tasas_bcv for update using (
  exists (select 1 from membresias m where m.usuario_id = auth.uid()
           and m.rol in ('presidente','tesorero','administrador') and m.activo))
  with check (true);
