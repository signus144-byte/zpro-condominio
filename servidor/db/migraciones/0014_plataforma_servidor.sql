-- =====================================================================
-- ZPro Condominio · 0014 Plataforma (consola master) sobre el servidor propio
-- =====================================================================

-- Al dar de alta un condominio, ZentaPro crea sus cuentas de pago (vacías: la junta completa los datos).
create policy plataforma_crear_cuentas on cuentas_financieras for insert
  with check (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));

-- Pagos reportados por las juntas a ZentaPro, con el nombre del condominio y de quien reportó.
-- (perfiles de otros usuarios no son legibles por RLS para el personal de ZentaPro.)
create or replace function pagos_plataforma_lista(p_solo_reportados boolean default true)
returns table (id uuid, factura_id uuid, condominio_id uuid, condominio text, metodo metodo_pago, moneda moneda,
               monto numeric, referencia text, estado estado_pago, creado_en timestamptz, reportado_por text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin_plataforma() then raise exception 'Sin permiso'; end if;
  return query
    select p.id, p.factura_id, p.condominio_id, c.nombre, p.metodo, p.moneda, p.monto, p.referencia, p.estado, p.creado_en, pf.nombre
      from pagos_plataforma p
      join condominios c on c.id = p.condominio_id
      left join perfiles pf on pf.id = p.reportado_por
     where not p_solo_reportados or p.estado = 'reportado'
     order by p.creado_en desc
     limit 300;
end $$;
