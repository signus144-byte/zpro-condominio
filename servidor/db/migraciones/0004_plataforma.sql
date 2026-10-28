-- =====================================================================
-- ZPro Condominio · 0004 Plataforma (multi-condominio + consola master ZentaPro)
-- Un solo servidor atiende a todos los condominios. Cada fila lleva su
-- condominio_id y la seguridad por filas (RLS) separa a uno de otro.
-- El personal de ZentaPro ve datos COMERCIALES (estado, plan, facturas,
-- métricas agregadas), nunca chats, pagos de residentes ni autoría de reportes.
-- =====================================================================

create type estado_condominio as enum ('prueba', 'activo', 'suspendido', 'baja');
create type tipo_desarrollo as enum ('edificio', 'conjunto_residencial', 'urbanizacion', 'centro_comercial');
create type tipo_unidad as enum ('apartamento', 'casa', 'local', 'oficina', 'townhouse');
create type rol_plataforma as enum ('dueno', 'soporte', 'finanzas');

-- ---------- Planes comerciales de ZentaPro ----------
create table planes (
  id text primary key,                         -- 'basico', 'completo'
  nombre text not null,
  precio_usd_unidad numeric(8,2) not null,     -- por casa/apartamento al mes
  minimo_usd numeric(8,2) not null default 0,  -- cobro mínimo mensual por condominio
  retencion_adjuntos_dias smallint not null default 30,
  incluye jsonb not null default '{}',         -- {"chat":true,"conciliacion_api":false,...}
  activo boolean not null default true
);

-- ---------- Condominio: datos comerciales y marca ----------
alter table condominios
  add column estado estado_condominio not null default 'prueba',
  add column plan_id text references planes(id),
  add column prueba_hasta date,
  add column activado_en timestamptz,
  add column codigo_activacion text unique,           -- lo entrega ZentaPro al presidente
  add column tipo tipo_desarrollo not null default 'edificio',
  add column nombre_asociacion text,                  -- "Asociación Civil de Propietarios Res. Los Samanes"
  add column ciudad text,
  add column estado_geo text,                          -- estado del país (Aragua, Carabobo…)
  add column telefono text,
  add column correo text,
  add column logo_path text,                           -- storage: marca/<condominio>/logo.png
  add column foto_entrada_path text,                   -- storage: marca/<condominio>/entrada.jpg (fachada o portón)
  add column color_primario text not null default '#0f4c4a' check (color_primario ~ '^#[0-9a-fA-F]{6}$'),
  add column retencion_adjuntos_dias smallint not null default 30 check (retencion_adjuntos_dias between 1 and 365),
  add column retencion_mensajes_meses smallint not null default 24 check (retencion_mensajes_meses between 1 and 120);

alter table unidades
  add column tipo tipo_unidad not null default 'apartamento';

-- Etiqueta visible ("Casa 28", "Apto B-34"): es el seudónimo de la unidad en chat y documentos.
create or replace function etiqueta_unidad(u unidades) returns text
language sql immutable as $$
  select case u.tipo when 'casa' then 'Casa ' when 'townhouse' then 'TH ' when 'local' then 'Local '
                     when 'oficina' then 'Ofic. ' else 'Apto ' end
         || coalesce(u.bloque || '-', '') || u.numero;
$$;

-- Cada residente decide si su nombre aparece en el directorio de vecinos (la junta siempre lo ve).
alter table membresias
  add column mostrar_en_directorio boolean not null default true,
  add column alta_en timestamptz not null default now();

-- ---------- Personal de ZentaPro ----------
create table plataforma_admins (
  usuario_id uuid primary key references perfiles(id) on delete cascade,
  rol rol_plataforma not null,
  activo boolean not null default true
);

-- Procesos internos del servidor (tareas programadas, webhooks): el servidor fija app.servicio = 'on'.
create or replace function es_servicio() returns boolean
language sql stable as $$
  select coalesce(current_setting('app.servicio', true), '') = 'on';
$$;

create or replace function es_admin_plataforma(roles rol_plataforma[] default array['dueno','soporte','finanzas']::rol_plataforma[])
returns boolean language sql stable security definer set search_path = public as $$
  select es_servicio() or exists (select 1 from plataforma_admins where usuario_id = auth.uid() and activo and rol = any(roles));
$$;

-- ---------- Códigos para unirse ----------
-- Un código por unidad (o por condominio para la junta). Se reparte impreso o por WhatsApp.
create table codigos_acceso (
  codigo text primary key,
  condominio_id uuid not null references condominios(id) on delete cascade,
  unidad_id uuid references unidades(id) on delete cascade,
  rol rol_condominio not null default 'propietario',
  usos_max smallint not null default 3,
  usos smallint not null default 0,
  expira_en timestamptz not null default now() + interval '60 days',
  requiere_aprobacion boolean not null default true,
  creado_por uuid references perfiles(id),
  check (rol in ('presidente','tesorero','vocal','administrador') or unidad_id is not null)
);

create table solicitudes_ingreso (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  unidad_id uuid references unidades(id) on delete cascade,
  rol rol_condominio not null,
  estado text not null default 'pendiente' check (estado in ('pendiente','aprobada','rechazada')),
  creado_en timestamptz not null default now(),
  revisado_por uuid references perfiles(id),
  unique (condominio_id, usuario_id, unidad_id, rol)
);

-- ¿Se puede escribir en este condominio? (suspendido o de baja = solo lectura)
create or replace function condominio_operativo(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select estado in ('prueba','activo') from condominios where id = cid), false);
$$;

-- El presidente activa su condominio con el código que le entregó ZentaPro.
create or replace function activar_condominio(p_codigo text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c condominios;
begin
  select * into c from condominios where codigo_activacion = upper(trim(p_codigo)) for update;
  if not found then raise exception 'Código de activación inválido'; end if;
  if c.estado in ('suspendido','baja') then raise exception 'Este condominio no está habilitado. Contacte a ZentaPro.'; end if;
  if exists (select 1 from membresias where condominio_id = c.id and rol = 'presidente' and activo) then
    raise exception 'Este condominio ya fue activado';
  end if;
  insert into membresias (condominio_id, usuario_id, rol) values (c.id, auth.uid(), 'presidente');
  perform set_config('zpro.sistema', 'on', true);   -- cambio interno autorizado (ver proteger_campos_comerciales)
  update condominios set activado_en = now(), codigo_activacion = null where id = c.id;
  return c.id;
end $$;

-- Un residente se une con el código de su casa/apartamento.
create or replace function unirse_con_codigo(p_codigo text)
returns text language plpgsql security definer set search_path = public as $$
declare k codigos_acceso;
begin
  select * into k from codigos_acceso where codigo = upper(trim(p_codigo)) for update;
  if not found or k.expira_en < now() or k.usos >= k.usos_max then raise exception 'Código inválido o vencido'; end if;
  if not condominio_operativo(k.condominio_id) then raise exception 'Este condominio no está habilitado'; end if;
  update codigos_acceso set usos = usos + 1 where codigo = k.codigo;
  if k.requiere_aprobacion then
    insert into solicitudes_ingreso (condominio_id, usuario_id, unidad_id, rol)
    values (k.condominio_id, auth.uid(), k.unidad_id, k.rol) on conflict do nothing;
    return 'pendiente';
  end if;
  insert into membresias (condominio_id, usuario_id, unidad_id, rol)
  values (k.condominio_id, auth.uid(), k.unidad_id, k.rol) on conflict do nothing;
  return 'aprobada';
end $$;

create or replace function resolver_solicitud(p_solicitud uuid, p_aprobar boolean)
returns void language plpgsql security definer set search_path = public as $$
declare s solicitudes_ingreso;
begin
  select * into s from solicitudes_ingreso where id = p_solicitud for update;
  if not found or s.estado <> 'pendiente' then raise exception 'Solicitud no disponible'; end if;
  if not tiene_rol(s.condominio_id, array['presidente','administrador']::rol_condominio[]) then raise exception 'Sin permiso'; end if;
  update solicitudes_ingreso set estado = case when p_aprobar then 'aprobada' else 'rechazada' end,
         revisado_por = auth.uid() where id = p_solicitud;
  if p_aprobar then
    insert into membresias (condominio_id, usuario_id, unidad_id, rol)
    values (s.condominio_id, s.usuario_id, s.unidad_id, s.rol) on conflict do nothing;
  end if;
end $$;

-- Directorio de casas: seudónimo de la unidad + nombres de quienes aceptaron aparecer.
-- La junta ve todos los nombres. Nunca se exponen teléfonos ni correos.
create or replace function directorio(p_condominio uuid)
returns table (unidad_id uuid, etiqueta text, bloque text, numero text, tipo tipo_unidad, nombres text[])
language plpgsql stable security definer set search_path = public as $$
declare v_junta boolean := es_junta(p_condominio);
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  return query
    select u.id, etiqueta_unidad(u), u.bloque, u.numero, u.tipo,
           coalesce(array_agg(distinct p.nombre) filter (where p.id is not null and (v_junta or m.mostrar_en_directorio)), '{}')
      from unidades u
      left join membresias m on m.unidad_id = u.id and m.activo
      left join perfiles p on p.id = m.usuario_id
     where u.condominio_id = p_condominio
     group by u.id
     order by u.bloque nulls first, u.numero;
end $$;

-- ---------- Cobro de ZentaPro a cada condominio ----------
create type estado_factura_plataforma as enum ('emitida', 'pagada', 'vencida', 'anulada');

create table facturas_plataforma (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  periodo date not null check (extract(day from periodo) = 1),
  plan_id text not null references planes(id),
  unidades_facturadas integer not null,
  precio_usd_unidad numeric(8,2) not null,
  monto_usd numeric(12,2) not null,
  tasa_bcv numeric(14,4) not null,            -- tasa del día de emisión
  monto_ves numeric(16,2) not null,           -- lo que se cobra en bolívares
  vence date not null,
  estado estado_factura_plataforma not null default 'emitida',
  numero_control text,                         -- asignado por la imprenta digital autorizada (SENIAT)
  pagada_en timestamptz,
  creado_en timestamptz not null default now(),
  unique (condominio_id, periodo)
);

create table pagos_plataforma (
  id uuid primary key default gen_random_uuid(),
  factura_id uuid not null references facturas_plataforma(id) on delete cascade,
  condominio_id uuid not null references condominios(id) on delete cascade,
  metodo metodo_pago not null,
  moneda moneda not null,
  monto numeric(16,2) not null check (monto > 0),
  referencia text,
  origen text not null default 'manual' check (origen in ('manual','extracto','api')),
  estado estado_pago not null default 'reportado',
  reportado_por uuid references perfiles(id),
  confirmado_por uuid references perfiles(id),
  creado_en timestamptz not null default now()
);

-- Emite la factura mensual de un condominio (la llama un proceso programado el día 1).
create or replace function facturar_condominio(p_condominio uuid, p_periodo date)
returns uuid language plpgsql security definer set search_path = public as $$
declare c condominios; pl planes; n integer; t numeric; m numeric; v_id uuid;
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  select * into c from condominios where id = p_condominio;
  select * into pl from planes where id = c.plan_id;
  if pl.id is null then raise exception 'El condominio no tiene plan asignado'; end if;
  select count(*) into n from unidades where condominio_id = p_condominio;
  select usd_ves into t from tasas_bcv where fecha <= current_date order by fecha desc limit 1;
  if t is null then raise exception 'No hay tasa BCV cargada'; end if;
  m := greatest(round(n * pl.precio_usd_unidad, 2), pl.minimo_usd);
  insert into facturas_plataforma (condominio_id, periodo, plan_id, unidades_facturadas, precio_usd_unidad,
                                   monto_usd, tasa_bcv, monto_ves, vence)
  values (p_condominio, p_periodo, pl.id, n, pl.precio_usd_unidad, m, t, round(m * t, 2), greatest(p_periodo + 9, current_date + 5))
  returning id into v_id;
  return v_id;
end $$;

create or replace function confirmar_pago_plataforma(p_pago uuid)
returns void language plpgsql security definer set search_path = public as $$
declare p pagos_plataforma; f facturas_plataforma; pagado numeric;
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  select * into p from pagos_plataforma where id = p_pago for update;
  if p.estado <> 'reportado' then raise exception 'Pago ya revisado'; end if;
  update pagos_plataforma set estado = 'confirmado', confirmado_por = auth.uid() where id = p_pago;
  select * into f from facturas_plataforma where id = p.factura_id;
  select coalesce(sum(case when moneda = 'VES' then monto else monto * f.tasa_bcv end), 0) into pagado
    from pagos_plataforma where factura_id = f.id and estado = 'confirmado';
  if pagado >= f.monto_ves - 0.01 then
    update facturas_plataforma set estado = 'pagada', pagada_en = now() where id = f.id;
    -- Si estaba suspendido por falta de pago y ya no debe otra factura, se reactiva solo.
    update condominios set estado = 'activo' where id = f.condominio_id and estado = 'suspendido'
       and not exists (select 1 from facturas_plataforma x where x.condominio_id = f.condominio_id and x.estado = 'vencida');
  end if;
end $$;

-- Proceso diario: facturas vencidas hace más de N días → condominio suspendido (solo lectura).
create or replace function suspender_morosos_plataforma(p_dias_gracia integer default 10)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) and auth.uid() is not null then
    raise exception 'Sin permiso';
  end if;
  update facturas_plataforma set estado = 'vencida' where estado = 'emitida' and vence < current_date;
  with s as (
    update condominios c set estado = 'suspendido'
     where c.estado = 'activo' and exists (
       select 1 from facturas_plataforma f where f.condominio_id = c.id and f.estado = 'vencida'
          and f.vence < current_date - p_dias_gracia)
    returning 1)
  select count(*) into n from s;
  return n;
end $$;

-- Métricas agregadas para la consola (sin datos personales).
create or replace function metricas_plataforma()
returns table (condominio_id uuid, nombre text, estado estado_condominio, plan_id text, unidades bigint,
               usuarios bigint, unidades_con_app bigint, morosidad_pct numeric, ultima_factura estado_factura_plataforma)
language plpgsql stable security definer set search_path = public as $$
begin
  if not es_admin_plataforma() then raise exception 'Sin permiso'; end if;
  return query
    select c.id, c.nombre, c.estado, c.plan_id,
      (select count(*) from unidades u where u.condominio_id = c.id),
      (select count(distinct m.usuario_id) from membresias m where m.condominio_id = c.id and m.activo),
      (select count(distinct m.unidad_id) from membresias m where m.condominio_id = c.id and m.activo and m.unidad_id is not null),
      (select round(100.0 * count(*) filter (where e.saldo_usd > 0.009) / nullif(count(*), 0), 1)
         from estado_cuenta_unidad e where e.condominio_id = c.id),
      (select f.estado from facturas_plataforma f where f.condominio_id = c.id order by f.periodo desc limit 1)
    from condominios c order by c.nombre;
end $$;

-- ---------- Bloqueo de escritura en condominios suspendidos ----------
create or replace function exigir_condominio_operativo() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not condominio_operativo(coalesce(new.condominio_id, old.condominio_id)) then
    raise exception 'Condominio suspendido: solo lectura. Contacte a ZentaPro.';
  end if;
  return coalesce(new, old);
end $$;
create trigger operativo_gastos before insert or update on gastos for each row execute function exigir_condominio_operativo();
create trigger operativo_recibos before insert on recibos for each row execute function exigir_condominio_operativo();
create trigger operativo_partidas before insert or update on partidas_especiales for each row execute function exigir_condominio_operativo();
create trigger operativo_votaciones before insert or update on votaciones for each row execute function exigir_condominio_operativo();
create trigger operativo_reportes before insert on reportes for each row execute function exigir_condominio_operativo();
create trigger operativo_avisos before insert on avisos for each row execute function exigir_condominio_operativo();
-- Los residentes SÍ pueden seguir reportando pagos a su condominio aunque esté suspendido.

-- ---------- RLS ----------
alter table planes enable row level security;
alter table plataforma_admins enable row level security;
alter table codigos_acceso enable row level security;
alter table solicitudes_ingreso enable row level security;
alter table facturas_plataforma enable row level security;
alter table pagos_plataforma enable row level security;

create policy ver on planes for select using (auth.uid() is not null);
create policy gestionar on planes for all using (es_admin_plataforma(array['dueno']::rol_plataforma[]))
  with check (es_admin_plataforma(array['dueno']::rol_plataforma[]));

create policy ver on plataforma_admins for select using (usuario_id = auth.uid() or es_admin_plataforma(array['dueno']::rol_plataforma[]));
create policy gestionar on plataforma_admins for all using (es_admin_plataforma(array['dueno']::rol_plataforma[]))
  with check (es_admin_plataforma(array['dueno']::rol_plataforma[]));

-- ZentaPro ve y edita los datos comerciales de cualquier condominio.
create policy plataforma_ver on condominios for select using (es_admin_plataforma());
create policy plataforma_crear on condominios for insert with check (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));
create policy plataforma_editar on condominios for update using (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));
-- ZentaPro carga las unidades al dar de alta un condominio (importación desde Excel).
create policy plataforma_unidades on unidades for all using (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]))
  with check (es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));

create policy junta on codigos_acceso for all
  using (tiene_rol(condominio_id, array['presidente','administrador']::rol_condominio[]) or es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]))
  with check (tiene_rol(condominio_id, array['presidente','administrador']::rol_condominio[]) or es_admin_plataforma(array['dueno','soporte']::rol_plataforma[]));

create policy ver on solicitudes_ingreso for select using (usuario_id = auth.uid() or es_junta(condominio_id));

create policy ver on facturas_plataforma for select using (maneja_finanzas(condominio_id) or es_admin_plataforma());
create policy ver on pagos_plataforma for select using (maneja_finanzas(condominio_id) or es_admin_plataforma());
create policy reportar on pagos_plataforma for insert with check (
  (maneja_finanzas(condominio_id) and reportado_por = auth.uid() and estado = 'reportado')
  or es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]));

insert into planes (id, nombre, precio_usd_unidad, minimo_usd, retencion_adjuntos_dias, incluye) values
  ('basico', 'Básico', 0.30, 25, 15, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": false}'),
  ('completo', 'Completo', 0.45, 40, 60, '{"chat": true, "documentos": true, "conciliacion_extracto": true, "conciliacion_api": true}');

-- La junta puede editar nombre, marca y contacto de su condominio, pero no el estado comercial.
create or replace function proteger_campos_comerciales() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','soporte','finanzas']::rol_plataforma[])
     and auth.uid() is not null
     and coalesce(current_setting('zpro.sistema', true), '') <> 'on'
     and (new.estado is distinct from old.estado or new.plan_id is distinct from old.plan_id
          or new.prueba_hasta is distinct from old.prueba_hasta
          or new.codigo_activacion is distinct from old.codigo_activacion) then
    raise exception 'Solo ZentaPro puede cambiar el estado o el plan del condominio';
  end if;
  return new;
end $$;
create trigger condominios_comercial before update on condominios for each row execute function proteger_campos_comerciales();

-- El residente decide si su nombre aparece en el directorio de vecinos.
create or replace function mostrar_en_directorio(p_condominio uuid, p_mostrar boolean)
returns void language sql security definer set search_path = public as $$
  update membresias set mostrar_en_directorio = p_mostrar where condominio_id = p_condominio and usuario_id = auth.uid();
$$;

-- Procesos programados: solo el servidor (service_role) o el personal de ZentaPro.
revoke all on function suspender_morosos_plataforma(integer) from public, anon;

-- Al cambiar de plan, la retención de archivos del chat toma la del plan.
create or replace function aplicar_retencion_plan() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.plan_id is distinct from old.plan_id and new.plan_id is not null then
    select retencion_adjuntos_dias into new.retencion_adjuntos_dias from planes where id = new.plan_id;
  end if;
  return new;
end $$;
create trigger condominios_retencion before update of plan_id on condominios for each row execute function aplicar_retencion_plan();
