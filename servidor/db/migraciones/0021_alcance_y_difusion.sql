-- =====================================================================
-- ZPro Condominio · 0021 Alcance de las cuotas especiales y difusión masiva
--
-- Pedido de Dirección (8-nov-2026):
--  * Una cuota especial (con su votación) puede ser de TODO el condominio o solo de algunas casas:
--    una calle cerrada con portón eléctrico, un piso de un edificio con su propia llave, etc.
--    Con alcance limitado: solo esas casas la VEN, solo sus propietarios VOTAN (el umbral se mide
--    sobre ellas) y solo a ellas se les COBRA (repartido entre ellas por alícuota o en partes iguales).
--  * Difusión masiva: la junta manda un mensaje a todo el condominio, a un grupo de casas, a casas
--    elegidas, a las casas de una cuota especial o solo a las que aún no han votado. Llega como
--    notificación en la app (y push y correo si están disponibles).
--  * Grupos guardados ("Calle 3 · portón", "Torre B · piso 4") para no elegir las casas cada vez.
-- =====================================================================

-- ---------- Piso de cada unidad (para elegir "un piso") ----------
alter table unidades add column piso text;

-- Piso: el que cargó la junta o, si no, se deduce del número (34 → 3, 1204 → 12). Nulo si no se puede.
create or replace function piso_unidad(u unidades) returns text
language sql immutable as $$
  select coalesce(nullif(trim(u.piso), ''),
    case when u.numero ~ '^\D*\d{2}$' then substring(u.numero from '(\d)\d$')
         when u.numero ~ '^\D*\d{3}$' then substring(u.numero from '(\d)\d\d$')
         when u.numero ~ '^\D*\d{4}$' then ltrim(substring(u.numero from '(\d\d)\d\d$'), '0')
    end);
$$;

-- La misma pantalla de "ubicación de las casas" carga sector, posición y piso.
create or replace function fijar_cercania(p_condominio uuid, p_unidades uuid[], p_sectores text[], p_posiciones integer[],
                                          p_pisos text[] default null)
returns integer language plpgsql security definer set search_path = public as $$
declare n integer;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then raise exception 'Sin permiso'; end if;
  update unidades u set sector = nullif(trim(x.s), ''), posicion = x.p,
                        piso = case when p_pisos is null then u.piso else nullif(trim(x.pi), '') end
    from unnest(p_unidades, p_sectores, p_posiciones, coalesce(p_pisos, array_fill(null::text, array[cardinality(p_unidades)])))
         as x(id, s, p, pi)
   where u.id = x.id and u.condominio_id = p_condominio;
  get diagnostics n = row_count;
  return n;
end $$;
drop function if exists fijar_cercania(uuid, uuid[], text[], integer[]);

-- ---------- Grupos de casas guardados ----------
create table grupos_unidades (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  nombre text not null check (length(trim(nombre)) between 2 and 80),
  descripcion text,
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now(),
  unique (condominio_id, nombre)
);
create table grupo_unidades (
  grupo_id uuid not null references grupos_unidades(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  primary key (grupo_id, unidad_id)
);
alter table grupos_unidades enable row level security;
alter table grupo_unidades enable row level security;
create policy junta on grupos_unidades for all using (es_junta(condominio_id)) with check (es_junta(condominio_id));
create policy junta on grupo_unidades for all
  using (exists (select 1 from grupos_unidades g where g.id = grupo_id and es_junta(g.condominio_id)))
  with check (exists (select 1 from grupos_unidades g join unidades u on u.id = unidad_id
                       where g.id = grupo_id and es_junta(g.condominio_id) and u.condominio_id = g.condominio_id));
grant select, insert, update, delete on grupos_unidades, grupo_unidades to authenticated;

-- ---------- Alcance de las cuotas especiales ----------
alter table partidas_especiales
  add column alcance text not null default 'todos' check (alcance in ('todos', 'unidades')),
  add column alcance_nombre text;            -- "Calle 3 · portón", "Torre B · piso 4"
create table partida_unidades (
  partida_id uuid not null references partidas_especiales(id) on delete cascade,
  unidad_id uuid not null references unidades(id) on delete cascade,
  primary key (partida_id, unidad_id)
);
alter table partida_unidades enable row level security;
grant select, insert, delete on partida_unidades to authenticated;

-- Unidades a las que aplica una cuota especial.
create or replace function unidades_partida(p_partida uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from partidas_especiales p join unidades u on u.condominio_id = p.condominio_id
   where p.id = p_partida
     and (p.alcance = 'todos' or exists (select 1 from partida_unidades x where x.partida_id = p.id and x.unidad_id = u.id));
$$;

create or replace function unidad_en_partida(p_partida uuid, p_unidad uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from partidas_especiales p
                  where p.id = p_partida
                    and (p.alcance = 'todos' or exists (select 1 from partida_unidades x where x.partida_id = p.id and x.unidad_id = p_unidad)));
$$;

-- ¿Puedo ver esta cuota especial? La junta siempre; los demás solo si es de todos o si una de mis casas está incluida.
create or replace function puedo_ver_partida(p_partida uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from partidas_especiales p
                  where p.id = p_partida
                    and (es_junta(p.condominio_id)
                         or (p.estado <> 'borrador' and es_miembro(p.condominio_id)
                             and (p.alcance = 'todos'
                                  or exists (select 1 from partida_unidades x
                                              where x.partida_id = p.id and x.unidad_id in (select mis_unidades()))))));
$$;

create policy ver_alcance on partida_unidades for select using (puedo_ver_partida(partida_id));
create policy gestionar on partida_unidades for all
  using (exists (select 1 from partidas_especiales p where p.id = partida_id and es_junta(p.condominio_id)))
  with check (exists (select 1 from partidas_especiales p join unidades u on u.id = unidad_id
                       where p.id = partida_id and es_junta(p.condominio_id) and u.condominio_id = p.condominio_id));

drop policy ver on partidas_especiales;
create policy ver on partidas_especiales for select using (puedo_ver_partida(id));

-- Votaciones: visibles solo para quien puede ver su cuota especial.
create or replace function puedo_ver_votacion(p_votacion uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from votaciones v
                  where v.id = p_votacion
                    and (es_junta(v.condominio_id)
                         or (v.estado <> 'borrador' and es_miembro(v.condominio_id)
                             and (v.partida_id is null or puedo_ver_partida(v.partida_id)))));
$$;
drop policy ver on votaciones;
create policy ver on votaciones for select using (puedo_ver_votacion(id));

-- Gastos de una cuota especial limitada: solo los ven las casas incluidas (y la junta).
drop policy ver on gastos;
create policy ver on gastos for select using (
  es_miembro(condominio_id) and (partida_id is null or puedo_ver_partida(partida_id)));

-- Unidades con derecho a voto en una votación (las de su cuota especial, o todas).
create or replace function unidades_votacion(p_votacion uuid) returns setof uuid
language sql stable security definer set search_path = public as $$
  select u.id from votaciones v join unidades u on u.condominio_id = v.condominio_id
   where v.id = p_votacion and (v.partida_id is null or unidad_en_partida(v.partida_id, u.id));
$$;

create or replace function emitir_voto(p_votacion uuid, p_unidad uuid, p_opcion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v votaciones; v_nombre text;
begin
  select * into v from votaciones where id = p_votacion;
  if not found then raise exception 'Votación no existe'; end if;
  if v.estado <> 'abierta' or (v.abre_en is not null and now() < v.abre_en)
     or (v.cierra_en is not null and now() > v.cierra_en) then
    raise exception 'La votación no está abierta';
  end if;
  if not exists (select 1 from membresias m where m.usuario_id = auth.uid() and m.unidad_id = p_unidad
                   and m.rol = 'propietario' and m.activo and m.condominio_id = v.condominio_id) then
    raise exception 'Solo el propietario de la unidad puede votar';
  end if;
  if p_unidad not in (select unidades_votacion(p_votacion)) then
    select alcance_nombre into v_nombre from partidas_especiales where id = v.partida_id;
    raise exception 'Esta votación es solo para %', coalesce(v_nombre, 'las casas incluidas');
  end if;
  if not exists (select 1 from votacion_opciones where id = p_opcion and votacion_id = p_votacion) then
    raise exception 'Opción inválida';
  end if;
  insert into votos (votacion_id, unidad_id, opcion_id, emitido_por)
  values (p_votacion, p_unidad, p_opcion, auth.uid());
end $$;

-- Resultado: el peso se mide sobre las casas con derecho a voto (por alícuota relativa o una casa = un voto).
create or replace function resultado_votacion(p_votacion uuid)
returns table (opcion_id uuid, texto text, orden smallint, unidades bigint, peso_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v votaciones; n_unidades integer; total_alicuota numeric;
begin
  select * into v from votaciones where id = p_votacion;
  if not found or not puedo_ver_votacion(p_votacion) then raise exception 'Sin permiso'; end if;
  select count(*), coalesce(sum(u.alicuota), 0) into n_unidades, total_alicuota
    from unidades u where u.id in (select unidades_votacion(p_votacion));
  return query
    select o.id, o.texto, o.orden, count(vt.id),
           case when v.ponderacion = 'alicuota'
                then round(100.0 * coalesce(sum(u.alicuota), 0) / nullif(total_alicuota, 0), 4)
                else round(100.0 * count(vt.id) / nullif(n_unidades, 0), 4) end
      from votacion_opciones o
      left join votos vt on vt.opcion_id = o.id
      left join unidades u on u.id = vt.unidad_id
     where o.votacion_id = p_votacion
     group by o.id, o.texto, o.orden
     order by o.orden;
end $$;

-- Acta: solo las casas con derecho a voto.
create or replace function datos_acta_votacion(p_votacion uuid)
returns table (unidad text, propietario text, alicuota numeric, opcion text, emitido_en timestamptz, votante text)
language plpgsql stable security definer set search_path = public as $$
declare v votaciones;
begin
  select * into v from votaciones where id = p_votacion;
  if not found or not es_junta(v.condominio_id) then raise exception 'Sin permiso'; end if;
  return query
    select etiqueta_unidad(u), u.propietario_nombre, u.alicuota, o.texto, vt.emitido_en, p.nombre
      from unidades u
      left join votos vt on vt.unidad_id = u.id and vt.votacion_id = p_votacion
      left join votacion_opciones o on o.id = vt.opcion_id
      left join perfiles p on p.id = vt.emitido_por
     where u.id in (select unidades_votacion(p_votacion))
     order by u.bloque nulls first, u.numero;
end $$;

-- Recibos: la cuota especial se cobra solo a sus casas, repartida entre ELLAS (por alícuota relativa o partes iguales).
create or replace function generar_recibos(p_condominio uuid, p_periodo date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c condominios;
  v_comun numeric(14,2);
  v_fondo numeric(14,2);
  u record; p record; g record;
  v_recibo uuid;
  v_cuota numeric(14,2);
  v_base_alicuota numeric;
  v_base_unidades integer;
  v_n integer := 0;
begin
  if extract(day from p_periodo) <> 1 then raise exception 'El periodo debe ser el día 1 del mes'; end if;
  select * into c from condominios where id = p_condominio;
  if not found then raise exception 'Condominio no existe'; end if;
  if not maneja_finanzas(p_condominio) then raise exception 'Sin permiso'; end if;
  if exists (select 1 from recibos where condominio_id = p_condominio and periodo = p_periodo) then
    raise exception 'Los recibos de % ya fueron emitidos', to_char(p_periodo, 'MM/YYYY');
  end if;

  select coalesce(sum(monto_usd), 0) into v_comun
    from gastos where condominio_id = p_condominio and periodo = p_periodo and tipo = 'comun';
  v_fondo := round(v_comun * c.fondo_reserva_pct / 100, 2);

  for u in select * from unidades where condominio_id = p_condominio order by bloque, numero loop
    insert into recibos (condominio_id, unidad_id, periodo, vence)
    values (p_condominio, u.id, p_periodo, p_periodo + (c.dia_vencimiento - 1))
    returning id into v_recibo;

    if v_comun > 0 then
      insert into cargos (condominio_id, unidad_id, recibo_id, periodo, tipo, concepto, monto_usd)
      values (p_condominio, u.id, v_recibo, p_periodo, 'ordinaria',
              'Gastos comunes ' || to_char(p_periodo, 'MM/YYYY'), round(v_comun * u.alicuota / 100, 2));
    end if;
    if v_fondo > 0 then
      insert into cargos (condominio_id, unidad_id, recibo_id, periodo, tipo, concepto, monto_usd)
      values (p_condominio, u.id, v_recibo, p_periodo, 'fondo_reserva',
              'Fondo de reserva ' || c.fondo_reserva_pct || '%', round(v_fondo * u.alicuota / 100, 2));
    end if;

    for p in select * from partidas_especiales
              where condominio_id = p_condominio and estado in ('aprobada','en_ejecucion')
                and primera_cuota is not null
                and p_periodo >= primera_cuota
                and p_periodo < (primera_cuota + make_interval(months => numero_cuotas)) loop
      if not unidad_en_partida(p.id, u.id) then continue; end if;
      if p.alcance = 'todos' then
        v_base_alicuota := 100;   -- las alícuotas del documento de condominio suman 100 %
        select count(*) into v_base_unidades from unidades where condominio_id = p_condominio;
      else
        select coalesce(sum(x.alicuota), 0), count(*) into v_base_alicuota, v_base_unidades
          from unidades x where x.id in (select unidades_partida(p.id));
      end if;
      v_cuota := case when p.reparto = 'alicuota'
                      then round(p.presupuesto_usd / p.numero_cuotas * u.alicuota / nullif(v_base_alicuota, 0), 2)
                      else round(p.presupuesto_usd / p.numero_cuotas / nullif(v_base_unidades, 0), 2) end;
      insert into cargos (condominio_id, unidad_id, recibo_id, periodo, tipo, concepto, monto_usd, partida_id)
      values (p_condominio, u.id, v_recibo, p_periodo, 'extraordinaria',
              p.titulo || ' (cuota ' || (extract(year from age(p_periodo, p.primera_cuota)) * 12
                                         + extract(month from age(p_periodo, p.primera_cuota)) + 1)
                       || '/' || p.numero_cuotas || ')', v_cuota, p.id);
    end loop;

    for g in select * from gastos where condominio_id = p_condominio and periodo = p_periodo
                                    and tipo = 'no_comun' and unidad_id = u.id loop
      insert into cargos (condominio_id, unidad_id, recibo_id, periodo, tipo, concepto, monto_usd, gasto_id)
      values (p_condominio, u.id, v_recibo, p_periodo, 'no_comun', g.descripcion, g.monto_usd, g.id);
    end loop;

    update recibos set total_usd = (select coalesce(sum(monto_usd), 0) from cargos where recibo_id = v_recibo)
     where id = v_recibo;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ---------- Difusión masiva ----------
alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso', 'difusion'));

create table difusiones (
  id uuid primary key default gen_random_uuid(),
  condominio_id uuid not null references condominios(id) on delete cascade,
  titulo text not null check (length(titulo) between 3 and 120),
  cuerpo text not null check (length(cuerpo) between 3 and 2000),
  alcance text not null check (alcance in ('todos', 'grupo', 'unidades', 'partida', 'sin_votar')),
  alcance_nombre text,
  grupo_id uuid references grupos_unidades(id) on delete set null,
  partida_id uuid references partidas_especiales(id) on delete set null,
  solo_propietarios boolean not null default false,
  unidades integer not null default 0,
  personas integer not null default 0,
  creado_por uuid references perfiles(id),
  creado_en timestamptz not null default now()
);
create index difusiones_condominio on difusiones (condominio_id, creado_en desc);
alter table difusiones enable row level security;
create policy junta on difusiones for select using (es_junta(condominio_id));
grant select on difusiones to authenticated;

-- Casas destinatarias según el alcance pedido (función interna; valida que todo sea del condominio).
create or replace function unidades_difusion(p_condominio uuid, p_alcance text, p_grupo uuid, p_unidades uuid[], p_partida uuid)
returns setof uuid language plpgsql stable security definer set search_path = public as $$
declare v_vot uuid;
begin
  if p_alcance = 'todos' then
    return query select id from unidades where condominio_id = p_condominio;
  elsif p_alcance = 'grupo' then
    if not exists (select 1 from grupos_unidades where id = p_grupo and condominio_id = p_condominio) then
      raise exception 'Ese grupo no existe';
    end if;
    return query select unidad_id from grupo_unidades where grupo_id = p_grupo;
  elsif p_alcance = 'unidades' then
    return query select id from unidades where condominio_id = p_condominio and id = any(coalesce(p_unidades, '{}'));
  elsif p_alcance in ('partida', 'sin_votar') then
    if not exists (select 1 from partidas_especiales where id = p_partida and condominio_id = p_condominio) then
      raise exception 'Esa cuota especial no existe';
    end if;
    if p_alcance = 'partida' then
      return query select unidades_partida(p_partida);
    else
      select id into v_vot from votaciones where partida_id = p_partida and estado = 'abierta' order by creado_en desc limit 1;
      if v_vot is null then raise exception 'Esa cuota especial no tiene una votación abierta'; end if;
      return query select x from unidades_votacion(v_vot) x
                    where not exists (select 1 from votos vt where vt.votacion_id = v_vot and vt.unidad_id = x);
    end if;
  else
    raise exception 'Alcance inválido';
  end if;
end $$;
revoke all on function unidades_difusion(uuid, text, uuid, uuid[], uuid) from public, anon, authenticated;

-- Personas que recibirán una difusión (vista previa y envío usan lo mismo).
create or replace function personas_difusion(p_condominio uuid, p_alcance text, p_grupo uuid, p_unidades uuid[], p_partida uuid,
                                             p_solo_propietarios boolean)
returns table (unidades integer, personas integer, usuarios uuid[])
language plpgsql stable security definer set search_path = public as $$
declare v_u uuid[];
begin
  if not es_junta(p_condominio) then raise exception 'Solo la junta envía mensajes masivos'; end if;
  v_u := array(select unidades_difusion(p_condominio, p_alcance, p_grupo, p_unidades, p_partida));
  return query
    select cardinality(v_u),
           (select count(distinct m.usuario_id)::int from membresias m
             where m.unidad_id = any(v_u) and m.activo and m.usuario_id <> auth.uid()
               and (not p_solo_propietarios or m.rol = 'propietario')),
           array(select distinct m.usuario_id from membresias m
                  where m.unidad_id = any(v_u) and m.activo and m.usuario_id <> auth.uid()
                    and (not p_solo_propietarios or m.rol = 'propietario'));
end $$;

create or replace function difundir(p_condominio uuid, p_titulo text, p_cuerpo text, p_alcance text, p_grupo uuid,
                                    p_unidades uuid[], p_partida uuid, p_solo_propietarios boolean)
returns table (id uuid, unidades integer, personas integer)
language plpgsql security definer set search_path = public as $$
declare r record; v_id uuid; v_nombre text; v_hoy integer;
begin
  if not es_junta(p_condominio) then raise exception 'Solo la junta envía mensajes masivos'; end if;
  if not condominio_operativo(p_condominio) then raise exception 'El condominio está suspendido'; end if;
  select count(*) into v_hoy from difusiones d where d.condominio_id = p_condominio and d.creado_en > now() - interval '24 hours';
  if v_hoy >= 20 then raise exception 'Límite de 20 mensajes masivos por día alcanzado'; end if;
  select * into r from personas_difusion(p_condominio, p_alcance, p_grupo, p_unidades, p_partida, coalesce(p_solo_propietarios, false));
  if r.unidades = 0 then raise exception 'No hay casas en ese alcance'; end if;
  v_nombre := case p_alcance
    when 'todos' then 'Todo el condominio'
    when 'grupo' then (select nombre from grupos_unidades g where g.id = p_grupo)
    when 'unidades' then r.unidades || case when r.unidades = 1 then ' casa elegida' else ' casas elegidas' end
    when 'partida' then coalesce((select coalesce(alcance_nombre, case when alcance = 'todos' then 'Todo el condominio' end)
                                    from partidas_especiales x where x.id = p_partida), 'Casas de la cuota especial')
    else 'Casas que aún no han votado' end;
  insert into difusiones (condominio_id, titulo, cuerpo, alcance, alcance_nombre, grupo_id, partida_id, solo_propietarios,
                          unidades, personas, creado_por)
  values (p_condominio, trim(p_titulo), trim(p_cuerpo), p_alcance, v_nombre, p_grupo, p_partida, coalesce(p_solo_propietarios, false),
          r.unidades, r.personas, auth.uid())
  returning difusiones.id into v_id;
  perform notificar(r.usuarios, p_condominio, 'difusion', trim(p_titulo), trim(p_cuerpo),
                    jsonb_build_object('difusionId', v_id, 'pantalla', case when p_partida is not null then 'partidas' else 'avisos' end)
                      || case when p_partida is not null then jsonb_build_object('partidaId', p_partida) else '{}'::jsonb end,
                    true);
  id := v_id; unidades := r.unidades; personas := r.personas;
  return next;
end $$;
