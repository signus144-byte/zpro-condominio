-- =====================================================================
-- ZPro Condominio · Esquema base v0.1
-- PostgreSQL 18 (servidor propio ZPro). Moneda de cuenta: USD.
-- Los pagos en bolívares guardan la tasa BCV del día del pago.
-- =====================================================================

-- gen_random_uuid() viene incluido en Postgres 13+ (no requiere extensiones).

-- ---------- Tipos ----------
create type rol_condominio as enum (
  'presidente', 'tesorero', 'vocal', 'administrador', 'propietario', 'inquilino'
);
create type tipo_cuenta as enum ('banco_bs', 'banco_usd', 'caja', 'zelle', 'usdt', 'fondo_reserva');
create type moneda as enum ('USD', 'VES');
create type metodo_pago as enum ('pago_movil', 'transferencia', 'zelle', 'efectivo_usd', 'efectivo_bs', 'usdt', 'otro');
create type estado_pago as enum ('reportado', 'confirmado', 'rechazado');
create type tipo_cargo as enum ('ordinaria', 'fondo_reserva', 'extraordinaria', 'no_comun', 'multa', 'ajuste');
create type tipo_gasto as enum ('comun', 'no_comun', 'partida');
create type estado_partida as enum ('borrador', 'en_votacion', 'aprobada', 'rechazada', 'en_ejecucion', 'cerrada');
create type ponderacion_voto as enum ('alicuota', 'unidad');
create type estado_votacion as enum ('borrador', 'abierta', 'cerrada', 'anulada');
create type categoria_reporte as enum ('ruido', 'dano_area_comun', 'seguridad', 'limpieza', 'mascotas', 'estacionamiento', 'filtracion', 'electricidad', 'otro');
create type visibilidad_reporte as enum ('presidencia', 'comunidad');
create type estado_reporte as enum ('nuevo', 'en_revision', 'en_proceso', 'resuelto', 'descartado');

-- ---------- Comunidad ----------
create table condominios (
  id uuid primary key default gen_random_uuid(),
  nombre text not null,
  rif text,
  direccion text,
  fondo_reserva_pct numeric(5,2) not null default 10.00,  -- % sobre gastos comunes del mes
  dia_vencimiento smallint not null default 5 check (dia_vencimiento between 1 and 28),
  creado_en timestamptz not null default now()
);

create table perfiles (
  id uuid primary key references auth.users(id) on delete cascade,
  nombre text not null,
  telefono text,
  creado_en timestamptz not null default now()
);

create table unidades (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  bloque text,                     -- torre / bloque / edificio
  numero text not null,            -- apto, casa, local
  alicuota numeric(9,6) not null check (alicuota > 0 and alicuota <= 100),  -- % del documento de condominio
  propietario_nombre text,
  unique (condominio_id, bloque, numero)
);

create table membresias (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  unidad_id uuid references unidades(id) on delete set null,
  rol rol_condominio not null,
  activo boolean not null default true,
  unique (condominio_id, usuario_id, rol, unidad_id)
);

-- ---------- Columna financiera ----------
create table cuentas_financieras (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  nombre text not null,            -- "Banesco corriente", "Caja chica", "Fondo de reserva"
  tipo tipo_cuenta not null,
  moneda moneda not null,
  datos_pago text,                 -- lo que ve el residente: teléfono Pago Móvil, correo Zelle, etc.
  saldo_inicial numeric(14,2) not null default 0,  -- saldo al migrar la cuenta a la app
  activa boolean not null default true
);

create table tasas_bcv (
  fecha date primary key,
  usd_ves numeric(14,4) not null check (usd_ves > 0),
  fuente text not null default 'BCV'
);

create table proveedores (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  nombre text not null,
  rif text,
  telefono text,
  rubro text
);

create table partidas_especiales (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null,            -- "Pintura de fachada Bloque B"
  descripcion text,
  presupuesto_usd numeric(14,2) not null check (presupuesto_usd > 0),
  numero_cuotas smallint not null default 1 check (numero_cuotas between 1 and 24),
  primera_cuota date,              -- periodo (día 1 del mes) de la primera cuota
  reparto ponderacion_voto not null default 'alicuota',  -- cómo se cobra: por alícuota o partes iguales
  estado estado_partida not null default 'borrador',
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now()
);

create table gastos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  periodo date not null check (extract(day from periodo) = 1),
  tipo tipo_gasto not null default 'comun',
  categoria text not null,         -- vigilancia, conserjería, electricidad, agua, ascensor, jardinería…
  descripcion text not null,
  proveedor_id uuid references proveedores(id),
  cuenta_id uuid references cuentas_financieras(id),  -- de dónde salió el dinero
  moneda moneda not null,
  monto numeric(14,2) not null check (monto > 0),
  tasa_bcv numeric(14,4),          -- obligatoria si moneda = VES
  monto_usd numeric(14,2) not null,
  unidad_id uuid references unidades(id),             -- solo gastos no comunes
  partida_id uuid references partidas_especiales(id), -- solo gastos de partida
  factura_path text,               -- storage: facturas/<condominio>/<id>.jpg
  fecha_gasto date not null default current_date,
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now(),
  check (moneda = 'USD' or tasa_bcv is not null),
  check (tipo <> 'no_comun' or unidad_id is not null),
  check (tipo <> 'partida' or partida_id is not null)
);

create table recibos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  periodo date not null check (extract(day from periodo) = 1),
  total_usd numeric(14,2) not null default 0,
  vence date not null,
  emitido_en timestamptz not null default now(),
  unique (unidad_id, periodo)
);

-- Libro de cargos por unidad: el estado de cuenta es Σ cargos − Σ pagos confirmados.
create table cargos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  recibo_id uuid references recibos(id) on delete cascade,
  periodo date not null,
  tipo tipo_cargo not null,
  concepto text not null,
  monto_usd numeric(14,2) not null,   -- puede ser negativo en 'ajuste'
  partida_id uuid references partidas_especiales(id),
  gasto_id uuid references gastos(id),
  creado_en timestamptz not null default now()
);

create table pagos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  reportado_por uuid references perfiles(id),
  fecha_pago date not null,
  metodo metodo_pago not null,
  moneda moneda not null,
  monto numeric(14,2) not null check (monto > 0),
  tasa_bcv numeric(14,4),
  monto_usd numeric(14,2) not null check (monto_usd > 0),
  referencia text,
  banco_origen text,
  cuenta_destino_id uuid references cuentas_financieras(id),
  comprobante_path text,              -- storage: comprobantes/<condominio>/<id>.jpg
  nota text,
  estado estado_pago not null default 'reportado',
  motivo_rechazo text,
  revisado_por uuid references perfiles(id),
  revisado_en timestamptz,
  creado_en timestamptz not null default now(),
  check (moneda = 'USD' or tasa_bcv is not null)
);
-- Evita reportar dos veces la misma referencia bancaria en el mismo condominio.
create unique index pagos_referencia_unica on pagos (condominio_id, metodo, referencia)
  where referencia is not null and estado <> 'rechazado';

-- ---------- Votaciones ----------
create table votaciones (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null,
  descripcion text,
  partida_id uuid references partidas_especiales(id),
  ponderacion ponderacion_voto not null default 'alicuota',
  umbral_aprobacion_pct numeric(5,2) not null default 50.01, -- % del total del condominio, no solo de los votantes
  abre_en timestamptz,
  cierra_en timestamptz,
  estado estado_votacion not null default 'borrador',
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now()
);

create table votacion_opciones (
  id uuid primary key default gen_random_uuid(),
  votacion_id uuid not null references votaciones(id) on delete cascade,
  texto text not null,
  orden smallint not null default 0
);

-- Un voto por unidad (no por persona). Lo emite un propietario de esa unidad.
create table votos (
  id uuid primary key default gen_random_uuid(),
  votacion_id uuid not null references votaciones(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  opcion_id uuid not null references votacion_opciones(id) on delete cascade,
  emitido_por uuid not null references perfiles(id),
  emitido_en timestamptz not null default now(),
  unique (votacion_id, unidad_id)
);

-- ---------- Reportes de irregularidades ----------
create table reportes (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  categoria categoria_reporte not null,
  titulo text not null,
  descripcion text not null,
  ubicacion text,                  -- "Bloque B, apto 34", "Estacionamiento sótano 1"
  anonimo boolean not null default false,
  autor_id uuid references perfiles(id),  -- NULL siempre que anonimo = true
  visibilidad visibilidad_reporte not null default 'presidencia',
  estado estado_reporte not null default 'nuevo',
  creado_en timestamptz not null default now(),
  actualizado_en timestamptz not null default now(),
  check (not anonimo or autor_id is null)
);

-- Autoría de reportes anónimos: ninguna política RLS la expone.
-- Solo el servidor (service_role) la usa para limitar abuso (p. ej. 5 reportes/día).
-- Presidencia NO puede ver quién envió un reporte anónimo.
create table reportes_autoria_privada (
  reporte_id uuid primary key references reportes(id) on delete cascade,
  usuario_id uuid not null references perfiles(id) on delete cascade,
  creado_en timestamptz not null default now()
);

create table reporte_fotos (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references reportes(id) on delete cascade,
  path text not null               -- storage: reportes/<condominio>/<reporte>/<n>.jpg
);

create table reporte_comentarios (
  id uuid primary key default gen_random_uuid(),
  reporte_id uuid not null references reportes(id) on delete cascade,
  autor_id uuid references perfiles(id),
  es_oficial boolean not null default false,  -- respuesta de Presidencia
  texto text not null,
  creado_en timestamptz not null default now()
);

-- ---------- Avisos ----------
create table avisos (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null,
  cuerpo text not null,
  fijado boolean not null default false,
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now()
);

-- ---------- Bitácora (auditoría financiera) ----------
create table bitacora (
  id bigint generated always as identity primary key,
  condominio_id uuid,
  tabla text not null,
  registro_id uuid,
  accion text not null,
  usuario_id uuid,
  antes jsonb,
  despues jsonb,
  en timestamptz not null default now()
);

-- ---------- Índices ----------
create index on unidades (condominio_id);
create index on membresias (usuario_id);
create index on cargos (unidad_id, periodo);
create index on pagos (unidad_id, estado);
create index on pagos (condominio_id, estado);
create index on gastos (condominio_id, periodo);
create index on reportes (condominio_id, estado);
create index on votos (votacion_id);

-- ---------- Vistas ----------
create view estado_cuenta_unidad with (security_invoker = true) as
select
  u.id as unidad_id,
  u.condominio_id,
  u.bloque,
  u.numero,
  u.alicuota,
  coalesce((select sum(c.monto_usd) from cargos c where c.unidad_id = u.id), 0) as total_cargos_usd,
  coalesce((select sum(p.monto_usd) from pagos p where p.unidad_id = u.id and p.estado = 'confirmado'), 0) as total_pagado_usd,
  coalesce((select sum(c.monto_usd) from cargos c where c.unidad_id = u.id), 0)
    - coalesce((select sum(p.monto_usd) from pagos p where p.unidad_id = u.id and p.estado = 'confirmado'), 0) as saldo_usd
from unidades u;
-- Resultados de votación: ver la función resultado_votacion() en 0002 (agrega sin exponer votos ajenos).

-- Saldo de cada cuenta = saldo inicial + pagos confirmados que entraron − gastos pagados desde ella.
-- (security_invoker: solo la junta ve todos los pagos, así que solo a ella le da el saldo real.)
create view saldo_cuentas with (security_invoker = true) as
select
  c.id, c.condominio_id, c.nombre, c.tipo, c.moneda,
  c.saldo_inicial
  + coalesce((select sum(case when p.moneda = c.moneda then p.monto
                              when c.moneda = 'USD' then p.monto_usd
                              else round(p.monto * coalesce(p.tasa_bcv, 0), 2) end)
                from pagos p where p.cuenta_destino_id = c.id and p.estado = 'confirmado'), 0)
  - coalesce((select sum(case when g.moneda = c.moneda then g.monto
                              when c.moneda = 'USD' then g.monto_usd
                              else round(g.monto * coalesce(g.tasa_bcv, 0), 2) end)
                from gastos g where g.cuenta_id = c.id), 0) as saldo
from cuentas_financieras c;
