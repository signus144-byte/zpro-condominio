-- =====================================================================
-- ZPro Condominio · 0016 Planes por tamaño y cobro de ZentaPro solo en bolívares
--
-- Decisión de Dirección (27-oct-2026):
--  * Precio GLOBAL al mes según la cantidad de unidades del condominio (no por casa).
--    El plan se asigna solo según las unidades cargadas; ZentaPro puede fijar un precio especial.
--  * Todos los planes incluyen todo (cuenta de la junta, casas ilimitadas dentro del rango, chat, documentos…).
--  * La factura se expresa en dólares y se cobra SOLO en bolívares, a la tasa BCV del día en que se paga:
--    lo que se abona se convierte a dólares con la tasa de ese día, y la factura queda pagada cuando
--    los abonos confirmados cubren el monto en dólares. Así la devaluación no se come la cuota.
-- =====================================================================

-- ---------- Planes por tamaño ----------
alter table planes
  alter column precio_usd_unidad drop not null,
  add column precio_usd_mes numeric(8,2) check (precio_usd_mes > 0),
  add column hasta_unidades integer check (hasta_unidades > 0),     -- null = sin límite
  add column descripcion text;

-- Los planes por unidad de la v0.1–0.3 quedan solo como historia (facturas viejas los referencian).
update planes set activo = false where id in ('basico', 'completo');

insert into planes (id, nombre, precio_usd_mes, hasta_unidades, retencion_adjuntos_dias, incluye, descripcion) values
  ('pequeno', 'Pequeño', 40, 50, 60, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": true}',
   'Edificios y conjuntos pequeños'),
  ('mediano', 'Mediano', 70, 150, 60, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": true}',
   'Conjuntos residenciales medianos'),
  ('grande', 'Grande', 110, 300, 60, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": true}',
   'Urbanizaciones grandes'),
  ('extra', 'Extra grande', 150, null, 60, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": true}',
   'Más de 300 unidades')
on conflict (id) do nothing;

alter table planes add constraint planes_activos_con_precio check (not activo or precio_usd_mes is not null);

-- Plan que corresponde a un condominio con n unidades: el de menor tope que alcance (o el sin límite).
create or replace function plan_para_unidades(n integer) returns text
language sql stable security definer set search_path = public as $$
  select id from planes
   where activo and precio_usd_mes is not null and (hasta_unidades is null or hasta_unidades >= n)
   order by coalesce(hasta_unidades, 2147483647), precio_usd_mes
   limit 1;
$$;

-- Precio especial negociado por ZentaPro (null = el del plan).
alter table condominios
  add column precio_especial_usd numeric(8,2) check (precio_especial_usd > 0),
  add column nota_precio text;

-- Mensualidad vigente en dólares de un condominio.
create or replace function mensualidad_usd(p_condominio uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(c.precio_especial_usd, p.precio_usd_mes)
    from condominios c left join planes p on p.id = c.plan_id
   where c.id = p_condominio;
$$;

-- Recalcula el plan de un condominio según sus unidades (sin pasar por la protección de campos comerciales).
create or replace function actualizar_plan_condominio(p_condominio uuid) returns void
language plpgsql security definer set search_path = public as $$
declare nuevo text; previo text;
begin
  nuevo := plan_para_unidades((select count(*)::int from unidades where condominio_id = p_condominio));
  if nuevo is null then return; end if;
  previo := current_setting('zpro.sistema', true);
  perform set_config('zpro.sistema', 'on', true);
  update condominios set plan_id = nuevo where id = p_condominio and plan_id is distinct from nuevo;
  perform set_config('zpro.sistema', coalesce(previo, ''), true);
end $$;
revoke all on function actualizar_plan_condominio(uuid) from public, anon, authenticated;

-- Al cargar o quitar unidades, el plan se ajusta solo.
create or replace function unidades_ajustar_plan() returns trigger
language plpgsql security definer set search_path = public as $$
declare cid uuid;
begin
  if tg_op = 'DELETE' then
    for cid in select distinct condominio_id from viejas loop perform actualizar_plan_condominio(cid); end loop;
  else
    for cid in select distinct condominio_id from nuevas loop perform actualizar_plan_condominio(cid); end loop;
  end if;
  return null;
end $$;
create trigger unidades_plan_insert after insert on unidades referencing new table as nuevas
  for each statement execute function unidades_ajustar_plan();
create trigger unidades_plan_delete after delete on unidades referencing old table as viejas
  for each statement execute function unidades_ajustar_plan();

-- Al cambiar los planes (precios o topes) desde la consola, todos los condominios se reubican.
create or replace function recalcular_planes() returns integer
language plpgsql security definer set search_path = public as $$
declare cid uuid; n integer := 0;
begin
  if not es_admin_plataforma(array['dueno']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  for cid in select id from condominios loop perform actualizar_plan_condominio(cid); n := n + 1; end loop;
  return n;
end $$;

-- Ubicar ya a los condominios existentes en el plan por tamaño.
do $$ declare cid uuid; begin
  for cid in select id from condominios loop perform actualizar_plan_condominio(cid); end loop;
end $$;

-- ---------- Facturas ----------
alter table facturas_plataforma
  alter column precio_usd_unidad drop not null,
  add column precio_especial boolean not null default false;
comment on column facturas_plataforma.monto_ves is 'Referencia en Bs a la tasa del día de emisión; se cobra a la tasa del día de pago';

create or replace function facturar_condominio(p_condominio uuid, p_periodo date)
returns uuid language plpgsql security definer set search_path = public as $$
declare c condominios; pl planes; n integer; t numeric; m numeric; v_id uuid;
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  perform actualizar_plan_condominio(p_condominio);
  select * into c from condominios where id = p_condominio;
  select * into pl from planes where id = c.plan_id;
  if pl.id is null then raise exception 'El condominio no tiene plan asignado'; end if;
  select count(*) into n from unidades where condominio_id = p_condominio;
  select usd_ves into t from tasas_bcv where fecha <= current_date order by fecha desc limit 1;
  if t is null then raise exception 'No hay tasa BCV cargada'; end if;
  m := coalesce(c.precio_especial_usd, pl.precio_usd_mes);
  if m is null then raise exception 'El plan % no tiene precio mensual', pl.id; end if;
  insert into facturas_plataforma (condominio_id, periodo, plan_id, unidades_facturadas, precio_usd_unidad, precio_especial,
                                   monto_usd, tasa_bcv, monto_ves, vence)
  values (p_condominio, p_periodo, pl.id, n, null, c.precio_especial_usd is not null,
          m, t, round(m * t, 2), greatest(p_periodo + 9, current_date + 5))
  returning id into v_id;
  return v_id;
end $$;

-- ---------- Pagos a ZentaPro: solo bolívares, a la tasa del día del pago ----------
alter table pagos_plataforma
  add column fecha_pago date not null default current_date,
  add column tasa_bcv numeric(14,4),
  add column monto_usd numeric(12,2),
  add column motivo_rechazo text;
alter table pagos_plataforma add constraint pagos_plataforma_solo_bs check (moneda = 'VES') not valid;

create or replace function pagos_plataforma_convertir() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.fecha_pago > current_date then raise exception 'La fecha del pago no puede ser futura'; end if;
  select usd_ves into new.tasa_bcv from tasas_bcv where fecha <= new.fecha_pago order by fecha desc limit 1;
  if new.tasa_bcv is null then raise exception 'No hay tasa BCV para la fecha del pago'; end if;
  new.monto_usd := round(new.monto / new.tasa_bcv, 2);
  return new;
end $$;
create trigger pagos_plataforma_convertir before insert on pagos_plataforma
  for each row execute function pagos_plataforma_convertir();

-- Lo abonado en dólares (pagos viejos sin conversión: a la tasa de la factura).
create or replace function abonado_usd_factura(p_factura uuid) returns numeric
language sql stable security definer set search_path = public as $$
  select coalesce(sum(coalesce(p.monto_usd, case when p.moneda = 'VES' then round(p.monto / f.tasa_bcv, 2) else p.monto end)), 0)
    from pagos_plataforma p join facturas_plataforma f on f.id = p.factura_id
   where p.factura_id = p_factura and p.estado = 'confirmado';
$$;

create or replace function confirmar_pago_plataforma(p_pago uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pagos_plataforma; f facturas_plataforma;
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  select * into p from pagos_plataforma where id = p_pago for update;
  if p.id is null then raise exception 'Pago no existe'; end if;
  if p.estado <> 'reportado' then raise exception 'Pago ya revisado'; end if;
  update pagos_plataforma set estado = 'confirmado', confirmado_por = auth.uid() where id = p_pago;
  select * into f from facturas_plataforma where id = p.factura_id for update;
  if abonado_usd_factura(f.id) >= f.monto_usd - 0.01 then
    update facturas_plataforma set estado = 'pagada', pagada_en = now() where id = f.id;
    -- Si estaba suspendido por falta de pago y ya no debe otra factura, se reactiva solo.
    update condominios set estado = 'activo' where id = f.condominio_id and estado = 'suspendido'
       and not exists (select 1 from facturas_plataforma x where x.condominio_id = f.condominio_id and x.estado = 'vencida');
  end if;
end $$;

create or replace function rechazar_pago_plataforma(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo del rechazo'; end if;
  update pagos_plataforma set estado = 'rechazado', confirmado_por = auth.uid(), motivo_rechazo = trim(p_motivo)
   where id = p_pago and estado = 'reportado';
  if not found then raise exception 'Pago no existe o ya fue revisado'; end if;
end $$;

drop function if exists pagos_plataforma_lista(boolean);
create or replace function pagos_plataforma_lista(p_solo_reportados boolean default true)
returns table (id uuid, factura_id uuid, condominio_id uuid, condominio text, metodo metodo_pago, moneda moneda,
               monto numeric, referencia text, estado estado_pago, creado_en timestamptz, reportado_por text,
               fecha_pago date, tasa_bcv numeric, monto_usd numeric, motivo_rechazo text)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin_plataforma() then raise exception 'Sin permiso'; end if;
  return query
    select p.id, p.factura_id, p.condominio_id, c.nombre, p.metodo, p.moneda, p.monto, p.referencia, p.estado, p.creado_en, pf.nombre,
           p.fecha_pago, p.tasa_bcv, p.monto_usd, p.motivo_rechazo
      from pagos_plataforma p
      join condominios c on c.id = p.condominio_id
      left join perfiles pf on pf.id = p.reportado_por
     where not p_solo_reportados or p.estado = 'reportado'
     order by p.creado_en desc
     limit 300;
end $$;

-- El precio especial es un dato comercial: solo ZentaPro lo cambia (la junta edita marca y contacto).
create or replace function proteger_campos_comerciales() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','soporte','finanzas']::rol_plataforma[])
     and auth.uid() is not null
     and coalesce(current_setting('zpro.sistema', true), '') <> 'on'
     and (new.estado is distinct from old.estado or new.plan_id is distinct from old.plan_id
          or new.prueba_hasta is distinct from old.prueba_hasta
          or new.codigo_activacion is distinct from old.codigo_activacion
          or new.precio_especial_usd is distinct from old.precio_especial_usd
          or new.nota_precio is distinct from old.nota_precio) then
    raise exception 'Solo ZentaPro puede cambiar el estado, el plan o el precio del condominio';
  end if;
  return new;
end $$;

-- Precio especial: lo fija el dueño o finanzas de ZentaPro (soporte no toca precios).
create or replace function fijar_precio_especial(p_condominio uuid, p_precio numeric, p_nota text)
returns boolean language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  update condominios set precio_especial_usd = p_precio, nota_precio = case when p_precio is null then null else nullif(trim(p_nota), '') end
   where id = p_condominio;
  return found;
end $$;
