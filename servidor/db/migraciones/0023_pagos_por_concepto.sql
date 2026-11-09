-- =====================================================================
-- Vecinos ZPro · 0023 Pagos por concepto, avance de cuotas especiales y cierre mensual
-- =====================================================================
--  * El vecino elige QUÉ paga (la cuota del mes, una cuota especial, varias…) y eso viaja con el pago (pago_destinos).
--  * Cuando la junta aprueba, el pago se descuenta de esas deudas (pago_aplicaciones); lo que sobra va a la deuda
--    más antigua y, si no hay, queda a favor y se descuenta solo del próximo recibo.
--  * La junta puede cambiar la asignación al aprobar.
--  * Cada cargo sabe cuánto se pagó (pagado / parcial / pendiente) y cada cuota especial cuánto lleva recaudado.
--  * reporte_mensual(): quién pagó y quién no, pagos aprobados/rechazados/en revisión, ingresos, egresos, saldos de las
--    cuentas, fondo de reserva y avance de las cuotas especiales. cerrar_mes() lo guarda tal cual (historial mes a mes).
-- Las asignaciones se recalculan completas por unidad (reaplicar_pagos_unidad): son deterministas y nunca se
-- "desordenan" si se borra un recibo, se rechaza o se aprueba un pago.

-- ---------- Qué eligió pagar el vecino ----------
create table pago_destinos (
  pago_id uuid not null references pagos(id) on delete cascade,
  cargo_id uuid not null references cargos(id) on delete cascade,
  orden smallint not null default 0,
  primary key (pago_id, cargo_id)
);
create index on pago_destinos (cargo_id);

-- ---------- Cómo quedó descontado ----------
create table pago_aplicaciones (
  id bigint generated always as identity primary key,
  unidad_id uuid not null references unidades(id) on delete cascade,
  cargo_id uuid not null references cargos(id) on delete cascade,
  pago_id uuid references pagos(id) on delete cascade,
  credito_cargo_id uuid references cargos(id) on delete cascade,   -- un ajuste negativo (nota de crédito)
  monto_usd numeric(14,2) not null check (monto_usd > 0),
  dirigido boolean not null default false,                          -- true: a lo que eligió el vecino o la junta
  check ((pago_id is null) <> (credito_cargo_id is null))
);
create index on pago_aplicaciones (unidad_id);
create index on pago_aplicaciones (cargo_id);
create index on pago_aplicaciones (pago_id);

alter table pago_destinos enable row level security;
alter table pago_aplicaciones enable row level security;
create policy ver on pago_destinos for select using (exists (select 1 from pagos p where p.id = pago_id));
create policy ver on pago_aplicaciones for select using (
  es_de_mi_unidad(unidad_id) or exists (select 1 from unidades u where u.id = unidad_id and es_junta(u.condominio_id)));

-- Prioridad dentro de un mismo mes: primero la cuota ordinaria, después fondo, no comunes, multas y cuotas especiales.
create or replace function prioridad_cargo(t tipo_cargo) returns integer language sql immutable as $$
  select case t when 'ordinaria' then 1 when 'fondo_reserva' then 2 when 'no_comun' then 3 when 'multa' then 4
                when 'extraordinaria' then 5 else 6 end;
$$;

-- ---------- Recalcular las asignaciones de una unidad ----------
-- 1) Cada pago confirmado (en el orden en que se aprobó) cubre primero lo que se eligió pagar.
-- 2) Las notas de crédito y lo que sobró de cada pago cubren las deudas más antiguas.
create or replace function reaplicar_pagos_unidad(p_unidad uuid)
returns void language plpgsql security definer set search_path = public as $$
declare cr record; d record; v_resto numeric; v_x numeric;
begin
  delete from pago_aplicaciones where unidad_id = p_unidad;
  create temp table if not exists _ap_pend (cargo_id uuid primary key, periodo date, prio integer, creado timestamptz, pendiente numeric) on commit drop;
  create temp table if not exists _ap_cred (orden integer, pago_id uuid, credito_id uuid, resto numeric) on commit drop;
  truncate _ap_pend; truncate _ap_cred;
  insert into _ap_pend select c.id, c.periodo, prioridad_cargo(c.tipo), c.creado_en, c.monto_usd
    from cargos c where c.unidad_id = p_unidad and c.monto_usd > 0;
  insert into _ap_cred
  select row_number() over (order by p.revisado_en nulls last, p.creado_en, p.id), p.id, null, p.monto_usd
    from pagos p where p.unidad_id = p_unidad and p.estado = 'confirmado';

  -- Paso 1: lo que eligió pagar
  for cr in select * from _ap_cred order by orden loop
    v_resto := cr.resto;
    for d in select pd.cargo_id from pago_destinos pd join _ap_pend x on x.cargo_id = pd.cargo_id
              where pd.pago_id = cr.pago_id order by pd.orden, x.periodo, x.prio loop
      exit when v_resto <= 0.004;
      select least(v_resto, pendiente) into v_x from _ap_pend where cargo_id = d.cargo_id;
      if v_x > 0.004 then
        insert into pago_aplicaciones (unidad_id, cargo_id, pago_id, monto_usd, dirigido) values (p_unidad, d.cargo_id, cr.pago_id, round(v_x, 2), true);
        update _ap_pend set pendiente = pendiente - v_x where cargo_id = d.cargo_id;
        v_resto := v_resto - v_x;
      end if;
    end loop;
    update _ap_cred set resto = v_resto where orden = cr.orden;
  end loop;

  -- Paso 2: notas de crédito (ajustes negativos) y lo que sobró, a lo más antiguo
  insert into _ap_cred select -row_number() over (order by c.periodo, c.creado_en), null, c.id, -c.monto_usd
    from cargos c where c.unidad_id = p_unidad and c.monto_usd < 0;
  for cr in select * from _ap_cred where resto > 0.004 order by (credito_id is null), orden loop
    v_resto := cr.resto;
    for d in select x.cargo_id, x.pendiente from _ap_pend x where x.pendiente > 0.004 order by x.periodo, x.prio, x.creado loop
      exit when v_resto <= 0.004;
      v_x := least(v_resto, d.pendiente);
      insert into pago_aplicaciones (unidad_id, cargo_id, pago_id, credito_cargo_id, monto_usd)
      values (p_unidad, d.cargo_id, cr.pago_id, cr.credito_id, round(v_x, 2));
      update _ap_pend set pendiente = pendiente - v_x where cargo_id = d.cargo_id;
      v_resto := v_resto - v_x;
    end loop;
  end loop;
end $$;
revoke all on function reaplicar_pagos_unidad(uuid) from public, anon, authenticated;

-- generar_recibos() inserta muchos cargos: difiere el recálculo y lo hace una vez por unidad al final.
create or replace function aplicacion_diferida() returns boolean language sql stable as $$
  select coalesce(current_setting('zpro.diferir_aplicacion', true), '') = 'on';
$$;

create or replace function cargos_reaplicar() returns trigger
language plpgsql security definer set search_path = public as $$
declare u uuid;
begin
  if aplicacion_diferida() then return null; end if;
  if tg_op = 'INSERT' then
    for u in select distinct unidad_id from nuevos loop perform reaplicar_pagos_unidad(u); end loop;
  elsif tg_op = 'UPDATE' then
    for u in select unidad_id from nuevos union select unidad_id from viejos loop
      if exists (select 1 from unidades where id = u) then perform reaplicar_pagos_unidad(u); end if;
    end loop;
  else
    for u in select distinct unidad_id from viejos loop
      if exists (select 1 from unidades where id = u) then perform reaplicar_pagos_unidad(u); end if;
    end loop;
  end if;
  return null;
end $$;
create trigger cargos_reaplicar_ins after insert on cargos referencing new table as nuevos
  for each statement execute function cargos_reaplicar();
create trigger cargos_reaplicar_upd after update on cargos referencing old table as viejos new table as nuevos
  for each statement execute function cargos_reaplicar();
create trigger cargos_reaplicar_del after delete on cargos referencing old table as viejos
  for each statement execute function cargos_reaplicar();

-- Nombre "pagos_aplicar" < "pagos_notificar": corre antes, así el aviso al vecino ya dice a qué se aplicó.
create or replace function pagos_reaplicar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'DELETE' then
    if old.estado = 'confirmado' and exists (select 1 from unidades where id = old.unidad_id) then
      perform reaplicar_pagos_unidad(old.unidad_id);
    end if;
    return null;
  end if;
  if new.estado = 'confirmado' or (tg_op = 'UPDATE' and old.estado = 'confirmado') then
    perform reaplicar_pagos_unidad(new.unidad_id);
    if tg_op = 'UPDATE' and old.unidad_id <> new.unidad_id then perform reaplicar_pagos_unidad(old.unidad_id); end if;
  end if;
  return null;
end $$;
create trigger pagos_aplicar after insert or update of estado, monto_usd, unidad_id or delete on pagos
  for each row execute function pagos_reaplicar();

-- ---------- Elegir a qué va un pago ----------
-- El vecino al reportarlo, o la junta al aprobarlo. Solo deudas positivas de la misma unidad, y solo mientras
-- el pago está en revisión.
create or replace function fijar_destinos_pago(p_pago uuid, p_cargos uuid[])
returns integer language plpgsql security definer set search_path = public as $$
declare v pagos; n integer; malos integer;
begin
  select * into v from pagos where id = p_pago for update;
  if not found then raise exception 'Pago no existe'; end if;
  if not (maneja_finanzas(v.condominio_id) or (v.reportado_por = auth.uid() and es_de_mi_unidad(v.unidad_id))) then
    raise exception 'Sin permiso';
  end if;
  if v.estado <> 'reportado' then raise exception 'El pago ya fue revisado (%)', v.estado; end if;
  select count(*) into malos from unnest(coalesce(p_cargos, '{}')) x(id)
   where not exists (select 1 from cargos c where c.id = x.id and c.unidad_id = v.unidad_id and c.monto_usd > 0);
  if malos > 0 then raise exception 'Alguna de las deudas elegidas no es de esta casa'; end if;
  delete from pago_destinos where pago_id = p_pago;
  insert into pago_destinos (pago_id, cargo_id, orden)
  select p_pago, x.id, min(x.o) - 1 from unnest(coalesce(p_cargos, '{}')) with ordinality x(id, o) group by x.id;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function fijar_destinos_pago(uuid, uuid[]) from public, anon;
grant execute on function fijar_destinos_pago(uuid, uuid[]) to authenticated;

drop function if exists confirmar_pago(uuid, uuid);
create or replace function confirmar_pago(p_pago uuid, p_cuenta_destino uuid default null, p_cargos uuid[] default null)
returns void language plpgsql security definer set search_path = public as $$
declare v pagos;
begin
  select * into v from pagos where id = p_pago for update;
  if not found then raise exception 'Pago no existe'; end if;
  if not maneja_finanzas(v.condominio_id) then raise exception 'Sin permiso'; end if;
  if v.estado <> 'reportado' then raise exception 'El pago ya fue revisado (%)', v.estado; end if;
  if p_cargos is not null then perform fijar_destinos_pago(p_pago, p_cargos); end if;
  update pagos set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(),
                   cuenta_destino_id = coalesce(p_cuenta_destino, cuenta_destino_id)
   where id = p_pago;
end $$;

-- ---------- Estado de cada cargo y recibo ----------
create view cargos_estado with (security_invoker = true) as
select c.*,
       coalesce(a.pagado, 0)::numeric(14,2) as pagado_usd,
       greatest(c.monto_usd - coalesce(a.pagado, 0), 0)::numeric(14,2) as pendiente_usd,
       case when c.monto_usd <= 0 then 'credito'
            when coalesce(a.pagado, 0) >= c.monto_usd - 0.005 then 'pagado'
            when coalesce(a.pagado, 0) > 0 then 'parcial'
            else 'pendiente' end as estado
  from cargos c
  left join (select cargo_id, sum(monto_usd) as pagado from pago_aplicaciones group by cargo_id) a on a.cargo_id = c.id;

-- ---------- Avance de las cuotas especiales ----------
-- Totales (lo ve quien puede ver la cuota: transparencia). El detalle por casa, solo la junta.
create or replace function avance_partidas(p_condominio uuid)
returns table (partida_id uuid, presupuesto_usd numeric, emitido_usd numeric, cobrado_usd numeric, pendiente_usd numeric,
               casas integer, casas_al_dia integer, cuotas_emitidas integer)
language sql stable security definer set search_path = public as $$
  with c as (
    select x.partida_id, x.unidad_id, x.periodo, x.monto_usd, coalesce(a.pagado, 0) as pagado
      from cargos x
      left join (select cargo_id, sum(monto_usd) pagado from pago_aplicaciones group by cargo_id) a on a.cargo_id = x.id
     where x.condominio_id = p_condominio and x.partida_id is not null and x.monto_usd > 0
  ), por_casa as (
    select partida_id, unidad_id, sum(monto_usd) cargado, sum(pagado) pagado from c group by partida_id, unidad_id
  )
  select p.id, p.presupuesto_usd,
         coalesce((select sum(monto_usd) from c where c.partida_id = p.id), 0),
         coalesce((select sum(pagado) from c where c.partida_id = p.id), 0),
         coalesce((select sum(greatest(monto_usd - pagado, 0)) from c where c.partida_id = p.id), 0),
         (select count(*)::int from por_casa k where k.partida_id = p.id),
         (select count(*)::int from por_casa k where k.partida_id = p.id and k.pagado >= k.cargado - 0.005),
         (select count(distinct periodo)::int from c where c.partida_id = p.id)
    from partidas_especiales p
   where p.condominio_id = p_condominio and puedo_ver_partida(p.id);
$$;
grant execute on function avance_partidas(uuid) to authenticated;

create or replace function cobro_partida(p_partida uuid)
returns table (unidad_id uuid, etiqueta text, propietario text, cargado_usd numeric, pagado_usd numeric, pendiente_usd numeric)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare cid uuid;
begin
  select condominio_id into cid from partidas_especiales where id = p_partida;
  if cid is null then raise exception 'Cuota especial no existe'; end if;
  if not es_junta(cid) then raise exception 'Sin permiso'; end if;
  return query
  select u.id, etiqueta_unidad(u), u.propietario_nombre, sum(x.monto_usd)::numeric, coalesce(sum(a.pagado), 0)::numeric,
         greatest(sum(x.monto_usd) - coalesce(sum(a.pagado), 0), 0)::numeric
    from cargos x join unidades u on u.id = x.unidad_id
    left join (select cargo_id, sum(monto_usd) pagado from pago_aplicaciones group by cargo_id) a on a.cargo_id = x.id
   where x.partida_id = p_partida and x.monto_usd > 0
   group by u.id
   order by greatest(sum(x.monto_usd) - coalesce(sum(a.pagado), 0), 0) desc, u.bloque nulls first, u.numero;
end $$;
grant execute on function cobro_partida(uuid) to authenticated;

-- ---------- Recibos: diferir el recálculo y hacerlo al final ----------
do $do$
declare src text;
begin
  src := pg_get_functiondef('generar_recibos(uuid, date)'::regprocedure);
  src := replace(src, E'  if extract(day from p_periodo) <> 1 then',
                      E'  perform set_config(''zpro.diferir_aplicacion'', ''on'', true);\n  if extract(day from p_periodo) <> 1 then');
  src := replace(src, E'  return v_n;\nend',
                      E'  perform set_config(''zpro.diferir_aplicacion'', ''off'', true);\n'
                   || E'  perform reaplicar_pagos_unidad(x.id) from unidades x where x.condominio_id = p_condominio;\n'
                   || E'  return v_n;\nend');
  if position('diferir_aplicacion'', ''off''' in src) = 0 then raise exception 'No se pudo adaptar generar_recibos'; end if;
  execute src;
end $do$;

-- Datos existentes: calcular las asignaciones por primera vez.
select reaplicar_pagos_unidad(id) from unidades;

-- ---------- Aviso al vecino: a qué se aplicó su pago ----------
create or replace function notificar_pago() returns trigger
language plpgsql security definer set search_path = public as $$
declare u unidades; casa text; saldo numeric; ref text; aplicado text;
begin
  select * into u from unidades where id = new.unidad_id;
  casa := etiqueta_unidad(u);
  ref := case when coalesce(new.referencia, '') <> '' then ' (ref. ' || new.referencia || ')' else '' end;

  if tg_op = 'INSERT' and new.estado = 'reportado' then
    perform notificar(usuarios_finanzas(new.condominio_id), new.condominio_id, 'pago_reportado',
      'Pago por revisar: ' || casa,
      casa || ' reportó ' || texto_monto_pago(new) || ref || '. Concílielo en el banco y apruébelo o recháselo.',
      jsonb_build_object('pagoId', new.id, 'pantalla', 'pagos'));
    return null;
  end if;

  if (tg_op = 'INSERT' and new.estado = 'confirmado')
     or (tg_op = 'UPDATE' and new.estado is distinct from old.estado and new.estado in ('confirmado', 'rechazado')) then
    if new.estado = 'confirmado' then
      select e.saldo_usd into saldo from estado_cuenta_unidad e where e.unidad_id = new.unidad_id;
      select string_agg(c.concepto || ' ($' || formato_ve(a.monto_usd) || ')', ', ' order by c.periodo, prioridad_cargo(c.tipo))
        into aplicado from pago_aplicaciones a join cargos c on c.id = a.cargo_id where a.pago_id = new.id;
      perform notificar(array(select usuarios_de_unidad(new.unidad_id)), new.condominio_id, 'pago_confirmado',
        'Pago aprobado',
        'La junta aprobó su pago de ' || texto_monto_pago(new) || ref || ' del ' || to_char(new.fecha_pago, 'DD/MM/YYYY') || '. '
          || coalesce('Se descontó de: ' || aplicado || '. ', '')
          || case when coalesce(saldo, 0) > 0.009 then 'Saldo pendiente: $' || formato_ve(saldo) || '.'
                  when coalesce(saldo, 0) < -0.009 then 'Le quedan $' || formato_ve(-saldo) || ' a favor para el próximo recibo.'
                  else 'Está al día.' end,
        jsonb_build_object('pagoId', new.id, 'pantalla', 'estado-cuenta'), true);
    else
      perform notificar(array(select usuarios_de_unidad(new.unidad_id)), new.condominio_id, 'pago_rechazado',
        'Pago rechazado',
        'La junta rechazó su pago de ' || texto_monto_pago(new) || ref || '. Motivo: '
          || coalesce(nullif(trim(new.motivo_rechazo), ''), 'sin indicar') || '. Revise los datos y vuelva a reportarlo.',
        jsonb_build_object('pagoId', new.id, 'pantalla', 'estado-cuenta'), true);
    end if;
  end if;
  return null;
end $$;

-- ---------- Reporte mensual ----------
-- Saldos "al cierre": cargos de ese mes o antes − pagos aprobados con fecha de pago hasta el último día del mes.
create or replace function reporte_mensual(p_condominio uuid, p_periodo date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  ini date := p_periodo; fin date := (p_periodo + interval '1 month' - interval '1 day')::date;
  t record; r jsonb;
begin
  if extract(day from p_periodo) <> 1 then raise exception 'El periodo debe ser el día 1 del mes'; end if;
  if not (es_junta(p_condominio) or es_servicio()) then raise exception 'Sin permiso'; end if;
  select * into t from tasa_para(least(fin, hoy_caracas()));

  with
  cu as (select u.*, etiqueta_unidad(u) as etq from unidades u where u.condominio_id = p_condominio),
  car as (select c.* from cargos c where c.condominio_id = p_condominio),
  pag as (select p.* from pagos p where p.condominio_id = p_condominio),
  apl as (select a.cargo_id, sum(a.monto_usd) pagado from pago_aplicaciones a join cu on cu.id = a.unidad_id group by a.cargo_id),
  casas as (
    select cu.id, cu.etq, cu.propietario_nombre, cu.alicuota, cu.bloque, cu.numero,
      coalesce((select sum(monto_usd) from car where car.unidad_id = cu.id and car.periodo < ini), 0)
        - coalesce((select sum(monto_usd) from pag where pag.unidad_id = cu.id and pag.estado = 'confirmado' and pag.fecha_pago < ini), 0) as anterior,
      coalesce((select sum(monto_usd) from car where car.unidad_id = cu.id and car.periodo = ini), 0) as facturado,
      coalesce((select sum(monto_usd) from pag where pag.unidad_id = cu.id and pag.estado = 'confirmado' and pag.fecha_pago between ini and fin), 0) as pagado,
      (select count(*) from pag where pag.unidad_id = cu.id and pag.estado = 'rechazado' and pag.fecha_pago between ini and fin) as rechazados,
      (select count(*) from pag where pag.unidad_id = cu.id and pag.estado = 'reportado' and pag.fecha_pago between ini and fin) as en_revision,
      (select case when count(*) = 0 then 'sin_recibo'
                   when sum(greatest(car.monto_usd - coalesce(apl.pagado, 0), 0)) filter (where car.monto_usd > 0) <= 0.009 then 'pagado'
                   when coalesce(sum(apl.pagado), 0) > 0 then 'parcial' else 'pendiente' end
         from car left join apl on apl.cargo_id = car.id where car.unidad_id = cu.id and car.periodo = ini) as recibo
    from cu
  ),
  casas2 as (select *, anterior + facturado - pagado as final from casas),
  pagos_mes as (
    select p.*, cu.etq from pag p join cu on cu.id = p.unidad_id where p.fecha_pago between ini and fin
  ),
  gastos_mes as (
    select g.*, cf.nombre as cuenta, pv.nombre as proveedor from gastos g
      left join cuentas_financieras cf on cf.id = g.cuenta_id left join proveedores pv on pv.id = g.proveedor_id
     where g.condominio_id = p_condominio and g.periodo = ini
  ),
  -- Movimiento de cada cuenta en su moneda (igual que la vista saldo_cuentas)
  mov as (
    select cf.id, cf.nombre, cf.moneda, cf.tipo, cf.saldo_inicial,
      coalesce((select sum(case when p.moneda = cf.moneda then p.monto when cf.moneda = 'USD' then p.monto_usd
                                else round(p.monto * coalesce(p.tasa_bcv, 0), 2) end)
                  from pag p where p.cuenta_destino_id = cf.id and p.estado = 'confirmado' and p.fecha_pago < ini), 0) as ent_antes,
      coalesce((select sum(case when p.moneda = cf.moneda then p.monto when cf.moneda = 'USD' then p.monto_usd
                                else round(p.monto * coalesce(p.tasa_bcv, 0), 2) end)
                  from pag p where p.cuenta_destino_id = cf.id and p.estado = 'confirmado' and p.fecha_pago between ini and fin), 0) as ent_mes,
      coalesce((select sum(case when g.moneda = cf.moneda then g.monto when cf.moneda = 'USD' then g.monto_usd
                                else round(g.monto * coalesce(g.tasa_bcv, 0), 2) end)
                  from gastos g where g.cuenta_id = cf.id and g.periodo < ini), 0) as sal_antes,
      coalesce((select sum(case when g.moneda = cf.moneda then g.monto when cf.moneda = 'USD' then g.monto_usd
                                else round(g.monto * coalesce(g.tasa_bcv, 0), 2) end)
                  from gastos g where g.cuenta_id = cf.id and g.periodo = ini), 0) as sal_mes
      from cuentas_financieras cf where cf.condominio_id = p_condominio
  )
  select jsonb_build_object(
    'periodo', ini, 'desde', ini, 'hasta', fin, 'generadoEn', now(),
    'tasaBcv', t.usd_ves, 'tasaFecha', t.fecha,
    'resumen', jsonb_build_object(
      'facturadoUsd', coalesce((select sum(monto_usd) from car where periodo = ini), 0),
      'facturadoPorTipo', coalesce((select jsonb_object_agg(tipo::text, s) from (select tipo, sum(monto_usd) s from car where periodo = ini group by tipo) x), '{}'),
      'cobradoUsd', coalesce((select sum(monto_usd) from pagos_mes where estado = 'confirmado'), 0),
      'cobradoBs', coalesce((select sum(monto) from pagos_mes where estado = 'confirmado' and moneda = 'VES'), 0),
      'cobradoDivisasUsd', coalesce((select sum(monto) from pagos_mes where estado = 'confirmado' and moneda = 'USD'), 0),
      'gastosUsd', coalesce((select sum(monto_usd) from gastos_mes), 0),
      'deudaInicialUsd', coalesce((select sum(greatest(anterior, 0)) from casas2), 0),
      'deudaFinalUsd', coalesce((select sum(greatest(final, 0)) from casas2), 0),
      'aFavorUsd', coalesce((select sum(greatest(-final, 0)) from casas2), 0),
      'totalCasas', (select count(*) from casas2),
      'casasAlDia', (select count(*) from casas2 where final <= 0.009),
      'casasConDeuda', (select count(*) from casas2 where final > 0.009),
      'pagosAprobados', (select count(*) from pagos_mes where estado = 'confirmado'),
      'pagosRechazados', (select count(*) from pagos_mes where estado = 'rechazado'),
      'pagosEnRevision', (select count(*) from pagos_mes where estado = 'reportado'),
      'enRevisionUsd', coalesce((select sum(monto_usd) from pagos_mes where estado = 'reportado'), 0)
    ),
    'casas', coalesce((select jsonb_agg(jsonb_build_object(
        'unidadId', id, 'etiqueta', etq, 'propietario', propietario_nombre, 'alicuota', alicuota,
        'saldoAnteriorUsd', round(anterior, 2), 'facturadoUsd', round(facturado, 2), 'pagadoUsd', round(pagado, 2),
        'saldoFinalUsd', round(final, 2),
        'estado', case when final > 0.009 then 'debe' when final < -0.009 then 'a_favor' else 'al_dia' end,
        'recibo', recibo, 'pagosRechazados', rechazados, 'pagosEnRevision', en_revision)
        order by bloque nulls first, numero) from casas2), '[]'),
    'pagos', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'unidad', p.etq, 'fechaPago', p.fecha_pago, 'metodo', p.metodo, 'moneda', p.moneda, 'monto', p.monto,
        'tasaBcv', p.tasa_bcv, 'montoUsd', p.monto_usd, 'referencia', p.referencia, 'estado', p.estado,
        'motivoRechazo', p.motivo_rechazo, 'revisadoEn', p.revisado_en,
        'aplicadoA', coalesce((select jsonb_agg(jsonb_build_object('concepto', c.concepto, 'periodo', c.periodo, 'montoUsd', a.monto_usd)
                                                order by c.periodo, prioridad_cargo(c.tipo))
                                 from pago_aplicaciones a join cargos c on c.id = a.cargo_id where a.pago_id = p.id), '[]'))
        order by p.fecha_pago, p.creado_en) from pagos_mes p), '[]'),
    'gastos', coalesce((select jsonb_agg(jsonb_build_object(
        'fecha', g.fecha_gasto, 'categoria', g.categoria, 'descripcion', g.descripcion, 'tipo', g.tipo, 'moneda', g.moneda,
        'monto', g.monto, 'tasaBcv', g.tasa_bcv, 'montoUsd', g.monto_usd, 'cuenta', g.cuenta, 'proveedor', g.proveedor)
        order by g.fecha_gasto, g.creado_en) from gastos_mes g), '[]'),
    'cuentas', coalesce((select jsonb_agg(jsonb_build_object(
        'nombre', nombre, 'moneda', moneda, 'tipo', tipo,
        'saldoInicial', round(saldo_inicial + ent_antes - sal_antes, 2), 'entradas', round(ent_mes, 2), 'salidas', round(sal_mes, 2),
        'saldoFinal', round(saldo_inicial + ent_antes - sal_antes + ent_mes - sal_mes, 2)) order by tipo, nombre) from mov), '[]'),
    'fondoReserva', jsonb_build_object(
      'facturadoAcumUsd', coalesce((select sum(monto_usd) from car where tipo = 'fondo_reserva' and periodo <= ini), 0),
      'cobradoAcumUsd', coalesce((select sum(a.monto_usd) from pago_aplicaciones a join car on car.id = a.cargo_id
                                   left join pag on pag.id = a.pago_id
                                  where car.tipo = 'fondo_reserva' and car.periodo <= ini
                                    and (a.pago_id is null or pag.fecha_pago <= fin)), 0)),
    'partidas', coalesce((select jsonb_agg(jsonb_build_object(
        'id', p.id, 'titulo', p.titulo, 'presupuestoUsd', p.presupuesto_usd, 'estado', p.estado,
        'emitidoUsd', coalesce((select sum(monto_usd) from car where car.partida_id = p.id and car.periodo <= ini and monto_usd > 0), 0),
        'cobradoUsd', coalesce((select sum(a.monto_usd) from pago_aplicaciones a join car on car.id = a.cargo_id
                                  left join pag on pag.id = a.pago_id
                                 where car.partida_id = p.id and car.periodo <= ini and (a.pago_id is null or pag.fecha_pago <= fin)), 0),
        'casas', (select count(distinct unidad_id) from car where car.partida_id = p.id and car.periodo <= ini))
        order by p.creado_en) from partidas_especiales p
        where p.condominio_id = p_condominio
          and exists (select 1 from car where car.partida_id = p.id and car.periodo <= ini)), '[]')
  ) into r;
  return r;
end $$;
grant execute on function reporte_mensual(uuid, date) to authenticated;

-- ---------- Cierre del mes (historial) ----------
create table cierres_mensuales (
  condominio_id uuid not null references condominios(id) on delete cascade,
  periodo date not null check (extract(day from periodo) = 1),
  datos jsonb not null,
  automatico boolean not null default false,
  cerrado_por uuid references perfiles(id),
  cerrado_en timestamptz not null default now(),
  primary key (condominio_id, periodo)
);
alter table cierres_mensuales enable row level security;
create policy ver on cierres_mensuales for select using (es_junta(condominio_id));

-- La junta (finanzas) cierra un mes ya terminado; puede volver a cerrarlo si llegaron pagos tarde.
-- La tarea del día 1 lo cierra sola (automatico = true) y avisa a la junta.
create or replace function cerrar_mes(p_condominio uuid, p_periodo date)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v_en timestamptz; auto boolean := es_servicio();
begin
  if not (maneja_finanzas(p_condominio) or auto) then raise exception 'Sin permiso'; end if;
  if extract(day from p_periodo) <> 1 then raise exception 'El periodo debe ser el día 1 del mes'; end if;
  if p_periodo >= date_trunc('month', hoy_caracas())::date then raise exception 'Ese mes todavía no ha terminado: se cierra desde el día 1 del mes siguiente'; end if;
  insert into cierres_mensuales as k (condominio_id, periodo, datos, automatico, cerrado_por)
  values (p_condominio, p_periodo, reporte_mensual(p_condominio, p_periodo), auto, case when auto then null else auth.uid() end)
  on conflict (condominio_id, periodo) do update
     set datos = excluded.datos, automatico = excluded.automatico, cerrado_por = excluded.cerrado_por, cerrado_en = now()
  returning k.cerrado_en into v_en;
  return v_en;
end $$;
grant execute on function cerrar_mes(uuid, date) to authenticated, servicio;

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso', 'difusion', 'cierre_mes', 'tasa_bcv'));

-- Día 1: cierra el mes anterior de cada condominio activo y avisa a quienes manejan las finanzas.
create or replace function cierre_automatico()
returns table (condominio_id uuid, periodo date)
language plpgsql security definer set search_path = public as $$
declare c record; v_per date := (date_trunc('month', hoy_caracas()) - interval '1 month')::date;
begin
  if not es_servicio() then raise exception 'Sin permiso'; end if;
  for c in select x.id from condominios x where x.estado in ('activo', 'prueba')
             and exists (select 1 from cargos k where k.condominio_id = x.id)
             and not exists (select 1 from cierres_mensuales k where k.condominio_id = x.id and k.periodo = v_per) loop
    perform cerrar_mes(c.id, v_per);
    perform notificar(usuarios_finanzas(c.id), c.id, 'cierre_mes', 'Cierre de ' || to_char(v_per, 'MM/YYYY') || ' listo',
      'Ya puede ver y descargar el reporte del mes: quién pagó, quién no, ingresos, gastos y saldos. '
      || 'Si aprueba pagos de ese mes más tarde, vuelva a cerrarlo para actualizarlo.',
      jsonb_build_object('pantalla', 'cierre', 'periodo', v_per));
    condominio_id := c.id; periodo := v_per; return next;
  end loop;
end $$;
revoke all on function cierre_automatico() from public, anon, authenticated;
grant execute on function cierre_automatico() to servicio;

-- Si a las 9:00 la tasa de hoy aún no tiene dos fuentes, se avisa a las juntas (una vez al día):
-- pueden confirmarla ellas mismas como segunda fuente desde "Tasa BCV".
create or replace function avisar_tasa_sin_verificar()
returns integer language plpgsql security definer set search_path = public as $$
declare c record; n integer := 0; e record;
begin
  if not es_servicio() then raise exception 'Sin permiso'; end if;
  if exists (select 1 from tasa_para(hoy_caracas())) then return 0; end if;
  select * into e from estado_tasa(null);
  for c in select x.id from condominios x where x.estado in ('activo', 'prueba')
             and not exists (select 1 from notificaciones k where k.condominio_id = x.id and k.tipo = 'tasa_bcv'
                               and (k.creado_en at time zone 'America/Caracas')::date = hoy_caracas()) loop
    n := n + notificar(usuarios_finanzas(c.id), c.id, 'tasa_bcv', 'Tasa BCV de hoy sin confirmar',
      coalesce(e.motivo, 'La tasa BCV de hoy no está confirmada.')
      || ' Mientras tanto los vecinos no pueden reportar pagos en bolívares. Revise bcv.org.ve y confírmela en Más → Tasa BCV.',
      jsonb_build_object('pantalla', 'tasa'));
  end loop;
  return n;
end $$;
revoke all on function avisar_tasa_sin_verificar() from public, anon, authenticated;
grant execute on function avisar_tasa_sin_verificar() to servicio;
