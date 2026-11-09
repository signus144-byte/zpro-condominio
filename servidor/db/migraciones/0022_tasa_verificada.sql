-- =====================================================================
-- Vecinos ZPro · 0022 Tasa BCV verificada con dos fuentes
-- =====================================================================
-- Un pago en bolívares se convierte a dólares con la tasa oficial del BCV del día del pago. Si la tasa está mal,
-- el vecino paga un monto equivocado y cree que está al día. Por eso:
--   * Cada consulta queda registrada en lecturas_tasa (fuente, fecha valor, valor, hora).
--   * Una tasa solo se acepta (tasas_bcv.verificada) cuando DOS FUENTES DISTINTAS dan la misma fecha valor y el
--     mismo valor (± 0,01 %): la página del BCV, DolarApi, la junta o el equipo de Technical Digital TD.
--   * tasas_bcv.vigente_hasta dice hasta qué día se comprobó que esa tasa seguía siendo la vigente. Sin esa
--     comprobación (servidor sin conexión, fuentes que no coinciden) NO se acepta un pago en bolívares de ese día.
--   * Fecha valor del BCV: la tasa publicada el viernes en la tarde rige desde el lunes. El sábado y el domingo
--     rige la del viernes, y así lo cubre vigente_hasta.

create or replace function hoy_caracas() returns date language sql stable as $$
  select (now() at time zone 'America/Caracas')::date;
$$;

alter table tasas_bcv
  add column if not exists verificada boolean not null default false,
  add column if not exists fuentes text[] not null default '{}',
  add column if not exists verificada_en timestamptz,
  add column if not exists vigente_hasta date,
  add column if not exists confirmada_en timestamptz;   -- última vez que dos fuentes la dieron como la más reciente

comment on column tasas_bcv.vigente_hasta is 'Último día en que se comprobó que esta tasa era la vigente';

create table lecturas_tasa (
  id bigint generated always as identity primary key,
  fuente text not null,                         -- 'BCV' | 'DolarApi' | 'junta:<uuid>' | 'consola:<uuid>'
  automatica boolean not null,
  fecha_valor date,
  usd_ves numeric(14,4),
  error text,                                   -- si la consulta falló
  leida_en timestamptz not null default now(),
  check ((error is null) = (usd_ves is not null and fecha_valor is not null)),
  check (usd_ves is null or usd_ves > 0)
);
create index on lecturas_tasa (leida_en desc);
create index on lecturas_tasa (fecha_valor, leida_en desc);
alter table lecturas_tasa enable row level security;
create policy ver on lecturas_tasa for select using (auth.uid() is not null);

-- Dos valores coinciden si la diferencia es ≤ 0,01 % (o un céntimo): la junta escribe 2 decimales, el BCV 8.
create or replace function tasas_coinciden(a numeric, b numeric) returns boolean language sql immutable as $$
  select abs(a - b) <= greatest(0.01, least(a, b) * 0.0001);
$$;

-- ---------- La tasa que rige un día ----------
-- La de fecha valor más reciente ≤ ese día, solo si está verificada y se comprobó vigente hasta ese día.
create or replace function tasa_para(p_fecha date)
returns table (fecha date, usd_ves numeric, fuentes text[], verificada_en timestamptz)
language sql stable security definer set search_path = public as $$
  select t.fecha, t.usd_ves, t.fuentes, t.verificada_en from (
    select * from tasas_bcv where tasas_bcv.fecha <= p_fecha order by tasas_bcv.fecha desc limit 1
  ) t
  where t.verificada and p_fecha <= coalesce(t.vigente_hasta, t.fecha);
$$;

-- ---------- Unir las lecturas: ¿hay dos fuentes que coinciden? ----------
-- Toma la lectura más reciente de cada fuente (automáticas de las últimas 6 h, manuales de las últimas 24 h)
-- y busca la fecha valor más reciente que tenga al menos dos fuentes con el mismo valor.
-- Devuelve el estado: 'verificada', 'una_fuente', 'no_coinciden' o 'sin_datos'.
create or replace function consolidar_tasa()
returns table (estado text, fecha date, usd_ves numeric, fuentes text[])
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  hoy date := hoy_caracas();
  g record; v_fecha date; v_valor numeric; v_fuentes text[]; prev tasas_bcv; v_cambio boolean := false;
  hay_conflicto boolean := false; n_lect integer;
begin
  create temp table if not exists _lect (fuente text, automatica boolean, fecha_valor date, usd_ves numeric) on commit drop;
  truncate _lect;
  -- Todas las personas de una junta cuentan como UNA fuente ("Junta"); el equipo de Technical Digital TD, como otra.
  insert into _lect
  select distinct on (k.f) k.f, l.automatica, l.fecha_valor, l.usd_ves
    from lecturas_tasa l
   cross join lateral (select case when l.fuente like 'junta:%' then 'Junta'
                                   when l.fuente like 'consola:%' then 'Technical Digital TD' else l.fuente end as f) k
   where l.error is null and l.fuente <> 'sistema'
     and l.leida_en > now() - case when l.automatica then interval '6 hours' else interval '24 hours' end
   order by k.f, l.leida_en desc;
  select count(*) into n_lect from _lect;
  if n_lect = 0 then return query select 'sin_datos'::text, null::date, null::numeric, '{}'::text[]; return; end if;

  -- Candidatas de la fecha valor más reciente a la más vieja (y el BCV primero). Coinciden las lecturas con el mismo
  -- valor (± 0,01 %) y fechas a ≤ 4 días (una fuente puede fechar por publicación y otra por fecha valor).
  for g in select * from _lect l order by l.fecha_valor desc, (l.fuente = 'BCV') desc, l.automatica asc loop
    select array_agg(b.fuente order by b.fuente) into v_fuentes from _lect b
     where tasas_coinciden(g.usd_ves, b.usd_ves) and abs(b.fecha_valor - g.fecha_valor) <= 4;
    if coalesce(array_length(v_fuentes, 1), 0) >= 2 then
      -- La fecha valor la da el BCV si está entre las que coinciden; si no, la confirmación manual; si no, la candidata.
      select b.fecha_valor into v_fecha from _lect b
       where b.fuente = any(v_fuentes) and tasas_coinciden(g.usd_ves, b.usd_ves)
       order by (b.fuente = 'BCV') desc, b.automatica asc, b.fecha_valor desc limit 1;
      -- El valor, de una fuente automática (más decimales que lo que escribe una persona).
      select b.usd_ves into v_valor from _lect b
       where b.fuente = any(v_fuentes) and tasas_coinciden(g.usd_ves, b.usd_ves)
       order by (b.fuente = 'BCV') desc, b.automatica desc limit 1;
      exit;
    end if;
    v_fuentes := null;
  end loop;
  -- Conflicto: dos fuentes con la MISMA fecha valor y valores distintos (no se adivina cuál es la buena).
  select exists (select 1 from _lect a join _lect b on a.fecha_valor = b.fecha_valor and a.fuente < b.fuente
                  where not tasas_coinciden(a.usd_ves, b.usd_ves)
                    and (v_fecha is null or a.fecha_valor >= v_fecha)) into hay_conflicto;

  if v_fecha is null or hay_conflicto then
    return query select case when hay_conflicto then 'no_coinciden' else 'una_fuente' end, null::date, null::numeric, '{}'::text[];
    return;
  end if;

  select * into prev from tasas_bcv where tasas_bcv.fecha = v_fecha;
  v_cambio := prev.fecha is not null and prev.verificada and not tasas_coinciden(prev.usd_ves, v_valor);
  insert into tasas_bcv as t (fecha, usd_ves, fuente, verificada, fuentes, verificada_en, confirmada_en, vigente_hasta)
  values (v_fecha, v_valor, array_to_string(v_fuentes, ' + '), true, v_fuentes, now(), now(),
          case when v_fecha <= hoy then hoy else v_fecha end)
  on conflict (fecha) do update
     set usd_ves = excluded.usd_ves, fuente = excluded.fuente, verificada = true, fuentes = excluded.fuentes,
         verificada_en = case when t.verificada and tasas_coinciden(t.usd_ves, excluded.usd_ves) then t.verificada_en else now() end,
         confirmada_en = now(),
         vigente_hasta = greatest(coalesce(t.vigente_hasta, excluded.vigente_hasta), excluded.vigente_hasta);

  -- Si ya se publicó la tasa de un día futuro (viernes en la tarde → lunes), la anterior sigue rigiendo hoy.
  -- Solo se extiende si esa anterior se había comprobado hasta ayer o hoy (sin huecos en los que pudo haber otra).
  if v_fecha > hoy then
    update tasas_bcv t set vigente_hasta = least(hoy, v_fecha - 1)
     where t.fecha = (select max(x.fecha) from tasas_bcv x where x.fecha < v_fecha)
       and t.verificada and coalesce(t.vigente_hasta, t.fecha) >= hoy - 1 and coalesce(t.vigente_hasta, t.fecha) < hoy;
  end if;
  -- Una tasa nueva cierra la vigencia de las anteriores (nunca se solapan).
  update tasas_bcv t set vigente_hasta = v_fecha - 1
   where t.fecha < v_fecha and t.vigente_hasta >= v_fecha;

  if v_cambio then
    -- Corrección de una tasa ya verificada: se avisa a Technical Digital TD.
    insert into lecturas_tasa (fuente, automatica, error) values ('sistema', true,
      'La tasa del ' || to_char(v_fecha, 'DD/MM/YYYY') || ' cambió de ' || prev.usd_ves || ' a ' || v_valor);
  end if;
  return query select 'verificada'::text, v_fecha, v_valor, v_fuentes;
end $$;
revoke all on function consolidar_tasa() from public, anon, authenticated;
grant execute on function consolidar_tasa() to servicio;

-- Registra una lectura automática (la llama la tarea programada del servidor) y consolida.
create or replace function registrar_lectura_tasa(p_fuente text, p_fecha date, p_usd_ves numeric, p_error text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_servicio() then raise exception 'Sin permiso'; end if;
  insert into lecturas_tasa (fuente, automatica, fecha_valor, usd_ves, error)
  values (p_fuente, true, case when p_error is null then p_fecha end, case when p_error is null then p_usd_ves end, p_error);
end $$;
revoke all on function registrar_lectura_tasa(text, date, numeric, text) from public, anon, authenticated;
grant execute on function registrar_lectura_tasa(text, date, numeric, text) to servicio;

-- ---------- Confirmación manual: la junta o el equipo de Technical Digital TD ----------
-- Cuenta como UNA fuente. Sirve de segunda fuente cuando una automática no responde.
create or replace function confirmar_tasa_manual(p_usd_ves numeric, p_fecha date default null)
returns table (estado text, fecha date, usd_ves numeric, fuentes text[])
language plpgsql security definer set search_path = public as $$
declare v_fuente text;
begin
  if p_usd_ves is null or p_usd_ves <= 0 or p_usd_ves > 1e7 then raise exception 'Tasa no válida'; end if;
  if coalesce(p_fecha, hoy_caracas()) > hoy_caracas() + 4 or coalesce(p_fecha, hoy_caracas()) < hoy_caracas() - 30 then
    raise exception 'La fecha valor debe ser de los últimos 30 días';
  end if;
  if es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) and not es_servicio() then
    v_fuente := 'consola:' || auth.uid();
  elsif exists (select 1 from membresias m where m.usuario_id = auth.uid()
                  and m.rol in ('presidente','tesorero','administrador') and m.activo) then
    v_fuente := 'junta:' || auth.uid();
  else
    raise exception 'Sin permiso';
  end if;
  insert into lecturas_tasa (fuente, automatica, fecha_valor, usd_ves)
  values (v_fuente, false, coalesce(p_fecha, hoy_caracas()), round(p_usd_ves, 4));
  return query select * from consolidar_tasa();
end $$;
revoke all on function confirmar_tasa_manual(numeric, date) from public, anon;
grant execute on function confirmar_tasa_manual(numeric, date) to authenticated;

-- ---------- Estado de la tasa para la app ----------
create or replace function estado_tasa(p_fecha date default null)
returns table (hoy date, fecha date, usd_ves numeric, verificada boolean, fuentes text[], verificada_en timestamptz,
               ultima_consulta timestamptz, motivo text)
language plpgsql stable security definer set search_path = public as $$
#variable_conflict use_column
declare d date := coalesce(p_fecha, hoy_caracas()); t record; ult timestamptz; conf boolean; ult_ok record;
begin
  select max(l.leida_en) into ult from lecturas_tasa l where l.automatica and l.fuente <> 'sistema';
  select * into t from tasa_para(d);
  if t.fecha is not null then
    return query select hoy_caracas(), t.fecha, t.usd_ves, true, t.fuentes, t.verificada_en, ult, null::text;
    return;
  end if;
  -- ¿Por qué no hay tasa? Para que la app lo diga claro.
  select exists (
    select 1 from lecturas_tasa a join lecturas_tasa b on a.fecha_valor = b.fecha_valor and a.fuente < b.fuente
     where a.error is null and b.error is null and a.leida_en > now() - interval '6 hours' and b.leida_en > now() - interval '6 hours'
       and not tasas_coinciden(a.usd_ves, b.usd_ves)) into conf;
  return query select hoy_caracas(), null::date, null::numeric, false, '{}'::text[], null::timestamptz, ult,
    case
      when d < hoy_caracas() - 30 then 'No hay tasa verificada para esa fecha.'
      when conf then 'Las fuentes de la tasa BCV no coinciden. La junta debe confirmarla antes de recibir pagos en bolívares.'
      when ult is null or ult < now() - interval '2 hours' then 'El servidor no ha podido consultar la tasa BCV. Intente más tarde.'
      else 'La tasa BCV de hoy aún no está confirmada por dos fuentes. Intente en unos minutos.'
    end;
end $$;
grant execute on function estado_tasa(date) to authenticated, anon;

-- Lecturas de hoy (pantalla "Tasa BCV" de la junta: de dónde salió cada número).
create or replace function lecturas_tasa_recientes()
returns table (fuente text, automatica boolean, fecha_valor date, usd_ves numeric, error text, leida_en timestamptz)
language sql stable security definer set search_path = public as $$
  select distinct on (case when l.fuente like 'junta:%' then 'junta' when l.fuente like 'consola:%' then 'consola' else l.fuente end)
         case when l.fuente like 'junta:%' then 'Junta' when l.fuente like 'consola:%' then 'Technical Digital TD' else l.fuente end,
         l.automatica, l.fecha_valor, l.usd_ves, l.error, l.leida_en
    from lecturas_tasa l
   where l.leida_en > now() - interval '24 hours' and l.fuente <> 'sistema'
   order by case when l.fuente like 'junta:%' then 'junta' when l.fuente like 'consola:%' then 'consola' else l.fuente end, l.leida_en desc;
$$;
grant execute on function lecturas_tasa_recientes() to authenticated;

-- La consola de Technical Digital TD ahora confirma (una fuente), no impone.
create or replace function plataforma_fijar_tasa_bcv(p_usd_ves numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not es_admin_plataforma(array['dueno','finanzas']::rol_plataforma[]) then raise exception 'Sin permiso'; end if;
  perform confirmar_tasa_manual(p_usd_ves, null);
end $$;

-- Nadie escribe tasas_bcv directamente: solo consolidar_tasa().
drop policy if exists cargar on tasas_bcv;
drop policy if exists corregir on tasas_bcv;

-- ---------- Pagos: la tasa del día del pago, verificada ----------
create or replace function pagos_antes_de_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  new.estado := 'reportado';
  new.reportado_por := auth.uid();
  new.revisado_por := null; new.revisado_en := null; new.motivo_rechazo := null;
  if new.moneda = 'USD' then
    new.tasa_bcv := null; new.monto_usd := new.monto;
  else
    select * into t from tasa_para(new.fecha_pago);
    if t.fecha is null then
      raise exception 'La tasa BCV del % todavía no está verificada. Intente de nuevo en unos minutos.', to_char(new.fecha_pago, 'DD/MM/YYYY');
    end if;
    new.tasa_bcv := t.usd_ves;
    new.monto_usd := round(new.monto / new.tasa_bcv, 2);
  end if;
  return new;
end $$;

-- Pagos a Technical Digital TD (solo bolívares): misma regla.
create or replace function pagos_plataforma_convertir() returns trigger
language plpgsql security definer set search_path = public as $$
declare t record;
begin
  if new.fecha_pago > hoy_caracas() then raise exception 'La fecha del pago no puede ser futura'; end if;
  select * into t from tasa_para(new.fecha_pago);
  if t.fecha is null then raise exception 'La tasa BCV del % todavía no está verificada', to_char(new.fecha_pago, 'DD/MM/YYYY'); end if;
  new.tasa_bcv := t.usd_ves;
  new.monto_usd := round(new.monto / new.tasa_bcv, 2);
  return new;
end $$;
