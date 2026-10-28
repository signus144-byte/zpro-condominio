-- =====================================================================
-- ZPro Condominio · 0007 Conciliación bancaria (automatizar la confirmación de pagos)
--
-- Tres niveles, de menor a mayor automatización:
--   1. Manual      Tesorería confirma cada pago reportado (0002).
--   2. Extracto    Tesorería sube el movimiento del banco (Excel/CSV que descarga
--                  de su banca en línea); el sistema cruza referencia + monto +
--                  fecha y confirma solo los que coinciden. Funciona con TODOS los bancos.
--   3. API         El banco (o un agregador) avisa cada pago recibido por webhook;
--                  se confirma en segundos sin intervención.
-- Los niveles 2 y 3 usan la misma función: conciliar_movimiento().
-- =====================================================================

create table extractos_bancarios (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  cuenta_id uuid not null references cuentas_financieras(id) on delete cascade,
  banco text,
  archivo_nombre text,
  desde date, hasta date,
  movimientos integer not null default 0,
  conciliados integer not null default 0,
  cargado_por uuid references perfiles(id),
  cargado_en timestamptz not null default now()
);

create table movimientos_bancarios (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  cuenta_id uuid not null references cuentas_financieras(id) on delete cascade,
  extracto_id uuid references extractos_bancarios(id) on delete cascade,
  origen text not null check (origen in ('extracto', 'api')),
  fecha date not null,
  referencia text,
  descripcion text,
  monto numeric(16,2) not null,                -- positivo = crédito (entra), negativo = débito
  moneda moneda not null,
  pago_id uuid references pagos(id),           -- pago con el que se concilió
  asignado_manual boolean not null default false,
  huella text not null,                        -- evita cargar dos veces el mismo movimiento
  creado_en timestamptz not null default now(),
  unique (cuenta_id, huella)
);
create index on movimientos_bancarios (condominio_id, pago_id);

alter table pagos
  add column confirmado_por_via text check (confirmado_por_via in ('manual', 'extracto', 'api')),
  add column movimiento_id uuid references movimientos_bancarios(id);

-- Configuración de la conexión con el banco o agregador (nivel 3).
-- Las credenciales NUNCA van en esta tabla: viven en la configuración secreta del servidor
-- (variable de entorno / archivo de secretos) y aquí solo se guarda su nombre.
create table conexiones_bancarias (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  cuenta_id uuid not null references cuentas_financieras(id) on delete cascade,
  proveedor text not null,                     -- 'pabilo', 'mercantil', 'banco_venezuela', 'activo', …
  secreto_vault text not null,                 -- nombre del secreto en la configuración del servidor
  webhook_token text not null unique default replace(gen_random_uuid()::text, '-', ''),
  activa boolean not null default true,
  creado_en timestamptz not null default now()
);

-- Normaliza referencias: solo dígitos, compara por los últimos 6 (los bancos muestran
-- largos distintos; Pago Móvil suele mostrar 8–12 dígitos).
create or replace function ref_corta(r text) returns text language sql immutable as $$
  select right(regexp_replace(coalesce(r, ''), '\D', '', 'g'), 6);
$$;

-- Busca el pago reportado que corresponde a un movimiento y lo confirma.
-- Coincidencia: misma cuenta destino (o sin cuenta indicada) + mismos 6 últimos dígitos
-- de referencia + mismo monto (±0,01) + fecha a ±3 días. Si hay más de uno, no adivina.
create or replace function conciliar_movimiento(p_mov uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare mv movimientos_bancarios; v_pago uuid; n integer;
begin
  select * into mv from movimientos_bancarios where id = p_mov for update;
  if mv.pago_id is not null or mv.monto <= 0 then return mv.pago_id; end if;
  select count(*), min(p.id::text)::uuid into n, v_pago from pagos p
   where p.condominio_id = mv.condominio_id and p.estado = 'reportado'
     and (p.cuenta_destino_id = mv.cuenta_id or p.cuenta_destino_id is null)
     and p.moneda = mv.moneda
     and abs(p.monto - mv.monto) <= 0.01
     and ref_corta(p.referencia) <> '' and ref_corta(p.referencia) = ref_corta(mv.referencia)
     and p.fecha_pago between mv.fecha - 3 and mv.fecha + 3;
  if n <> 1 then return null; end if;
  update pagos set estado = 'confirmado', revisado_en = now(), revisado_por = auth.uid(),
                   confirmado_por_via = mv.origen, movimiento_id = mv.id, cuenta_destino_id = mv.cuenta_id
   where id = v_pago;
  update movimientos_bancarios set pago_id = v_pago where id = mv.id;
  return v_pago;
end $$;

-- Carga un extracto (lista JSON de movimientos ya leídos del Excel/CSV por la app) y concilia.
-- p_movs: [{"fecha":"2026-10-27","referencia":"00123456","descripcion":"PAGO MOVIL ...","monto":21550.00}, ...]
create or replace function cargar_extracto(p_cuenta uuid, p_archivo text, p_movs jsonb)
returns table (cargados integer, duplicados integer, conciliados integer)
language plpgsql security definer set search_path = public as $$
declare c cuentas_financieras; v_ext uuid; m jsonb; v_mov uuid; n_c integer := 0; n_d integer := 0; n_k integer := 0; h text;
begin
  select * into c from cuentas_financieras where id = p_cuenta;
  if not found or not maneja_finanzas(c.condominio_id) then raise exception 'Sin permiso'; end if;
  insert into extractos_bancarios (condominio_id, cuenta_id, archivo_nombre, cargado_por)
  values (c.condominio_id, p_cuenta, p_archivo, auth.uid()) returning id into v_ext;
  for m in select * from jsonb_array_elements(p_movs) loop
    h := md5(concat_ws('|', m->>'fecha', m->>'referencia', m->>'monto', m->>'descripcion'));
    insert into movimientos_bancarios (condominio_id, cuenta_id, extracto_id, origen, fecha, referencia, descripcion, monto, moneda, huella)
    values (c.condominio_id, p_cuenta, v_ext, 'extracto', (m->>'fecha')::date, m->>'referencia', m->>'descripcion',
            (m->>'monto')::numeric, c.moneda, h)
    on conflict (cuenta_id, huella) do nothing
    returning id into v_mov;
    if v_mov is null then n_d := n_d + 1; continue; end if;
    n_c := n_c + 1;
    if conciliar_movimiento(v_mov) is not null then n_k := n_k + 1; end if;
    v_mov := null;
  end loop;
  update extractos_bancarios set movimientos = n_c, conciliados = n_k,
         desde = (select min(fecha) from movimientos_bancarios where extracto_id = v_ext),
         hasta = (select max(fecha) from movimientos_bancarios where extracto_id = v_ext)
   where id = v_ext;
  return query select n_c, n_d, n_k;
end $$;

-- Créditos del banco sin pago reportado: "dinero que entró y nadie avisó". La junta lo asigna a una unidad.
create or replace function asignar_movimiento(p_mov uuid, p_unidad uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare mv movimientos_bancarios; v_pago uuid;
begin
  select * into mv from movimientos_bancarios where id = p_mov for update;
  if not found or not maneja_finanzas(mv.condominio_id) then raise exception 'Sin permiso'; end if;
  if mv.pago_id is not null then raise exception 'Ese movimiento ya está conciliado'; end if;
  if mv.monto <= 0 then raise exception 'Solo se asignan créditos'; end if;
  -- Se crea el pago en nombre de la unidad y se confirma de una vez.
  insert into pagos (condominio_id, unidad_id, fecha_pago, metodo, moneda, monto, monto_usd, referencia, cuenta_destino_id, nota)
  values (mv.condominio_id, p_unidad, mv.fecha, case when mv.moneda = 'VES' then 'pago_movil' else 'zelle' end::metodo_pago,
          mv.moneda, mv.monto, mv.monto, mv.referencia, mv.cuenta_id, 'Asignado desde movimiento bancario')
  returning id into v_pago;
  update pagos set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(),
                   confirmado_por_via = 'extracto', movimiento_id = mv.id
   where id = v_pago;
  update movimientos_bancarios set pago_id = v_pago, asignado_manual = true where id = mv.id;
  return v_pago;
end $$;

-- confirmar_pago() manual (0002) deja constancia de la vía.
create or replace function pagos_via_manual() returns trigger language plpgsql as $$
begin
  if new.estado = 'confirmado' and old.estado = 'reportado' and new.confirmado_por_via is null then
    new.confirmado_por_via := 'manual';
  end if;
  return new;
end $$;
create trigger pagos_via before update on pagos for each row execute function pagos_via_manual();

alter table extractos_bancarios enable row level security;
alter table movimientos_bancarios enable row level security;
alter table conexiones_bancarias enable row level security;
create policy ver on extractos_bancarios for select using (maneja_finanzas(condominio_id));
create policy ver on movimientos_bancarios for select using (maneja_finanzas(condominio_id));
create policy ver on conexiones_bancarias for select using (maneja_finanzas(condominio_id) or es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));
create policy gestionar on conexiones_bancarias for all using (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]))
  with check (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));
