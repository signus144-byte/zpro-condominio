-- =====================================================================
-- ZPro Condominio · Funciones, reglas de negocio y seguridad por filas (RLS)
-- Principio: el residente REPORTA, la junta CONFIRMA. Todo lo que mueve
-- dinero pasa por funciones del servidor y queda en la bitácora.
-- =====================================================================

-- ---------- Ayudantes de permisos ----------
create or replace function es_miembro(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias m
                 where m.condominio_id = cid and m.usuario_id = auth.uid() and m.activo);
$$;

create or replace function tiene_rol(cid uuid, roles rol_condominio[]) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias m
                 where m.condominio_id = cid and m.usuario_id = auth.uid()
                   and m.activo and m.rol = any(roles));
$$;

-- Junta directiva + administrador: ven y gestionan todo el condominio.
create or replace function es_junta(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tiene_rol(cid, array['presidente','tesorero','vocal','administrador']::rol_condominio[]);
$$;

-- Quien puede tocar dinero (confirmar pagos, registrar gastos, emitir recibos).
create or replace function maneja_finanzas(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select tiene_rol(cid, array['presidente','tesorero','administrador']::rol_condominio[]);
$$;

create or replace function es_de_mi_unidad(uid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from membresias m
                 where m.unidad_id = uid and m.usuario_id = auth.uid() and m.activo);
$$;

-- ---------- Pagos ----------
create or replace function confirmar_pago(p_pago uuid, p_cuenta_destino uuid default null)
returns void language plpgsql security definer set search_path = public as $$
declare v pagos;
begin
  select * into v from pagos where id = p_pago for update;
  if not found then raise exception 'Pago no existe'; end if;
  if not maneja_finanzas(v.condominio_id) then raise exception 'Sin permiso'; end if;
  if v.estado <> 'reportado' then raise exception 'El pago ya fue revisado (%)', v.estado; end if;
  update pagos set estado = 'confirmado', revisado_por = auth.uid(), revisado_en = now(),
                   cuenta_destino_id = coalesce(p_cuenta_destino, cuenta_destino_id)
   where id = p_pago;
end $$;

create or replace function rechazar_pago(p_pago uuid, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
declare v pagos;
begin
  select * into v from pagos where id = p_pago for update;
  if not found then raise exception 'Pago no existe'; end if;
  if not maneja_finanzas(v.condominio_id) then raise exception 'Sin permiso'; end if;
  if v.estado <> 'reportado' then raise exception 'El pago ya fue revisado (%)', v.estado; end if;
  if coalesce(trim(p_motivo), '') = '' then raise exception 'Indique el motivo del rechazo'; end if;
  update pagos set estado = 'rechazado', motivo_rechazo = p_motivo,
                   revisado_por = auth.uid(), revisado_en = now()
   where id = p_pago;
end $$;

-- El residente no decide el estado ni quién reporta: se fuerza aquí.
create or replace function pagos_antes_de_insertar() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.estado := 'reportado';
  new.reportado_por := auth.uid();
  new.revisado_por := null; new.revisado_en := null; new.motivo_rechazo := null;
  if new.moneda = 'USD' then
    new.tasa_bcv := null; new.monto_usd := new.monto;
  else
    if new.tasa_bcv is null then
      select usd_ves into new.tasa_bcv from tasas_bcv where fecha <= new.fecha_pago order by fecha desc limit 1;
    end if;
    if new.tasa_bcv is null then raise exception 'No hay tasa BCV cargada para %', new.fecha_pago; end if;
    new.monto_usd := round(new.monto / new.tasa_bcv, 2);
  end if;
  return new;
end $$;
create trigger pagos_bi before insert on pagos for each row execute function pagos_antes_de_insertar();

-- ---------- Gastos ----------
create or replace function gastos_antes_de_guardar() returns trigger
language plpgsql set search_path = public as $$
begin
  if new.moneda = 'USD' then new.tasa_bcv := null; new.monto_usd := new.monto;
  else new.monto_usd := round(new.monto / new.tasa_bcv, 2);
  end if;
  if tg_op = 'INSERT' then new.creado_por := auth.uid(); end if;
  return new;
end $$;
create trigger gastos_biu before insert or update on gastos for each row execute function gastos_antes_de_guardar();

-- ---------- Recibos del mes ----------
-- Reparte los gastos comunes del periodo por alícuota, suma el fondo de reserva,
-- las cuotas de partidas especiales vigentes y los gastos no comunes de cada unidad.
create or replace function generar_recibos(p_condominio uuid, p_periodo date)
returns integer language plpgsql security definer set search_path = public as $$
declare
  c condominios;
  v_comun numeric(14,2);
  v_fondo numeric(14,2);
  u record; p record; g record;
  v_recibo uuid;
  v_total_unidades integer;
  v_cuota numeric(14,2);
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
  select count(*) into v_total_unidades from unidades where condominio_id = p_condominio;

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
      v_cuota := case when p.reparto = 'alicuota'
                      then round(p.presupuesto_usd / p.numero_cuotas * u.alicuota / 100, 2)
                      else round(p.presupuesto_usd / p.numero_cuotas / v_total_unidades, 2) end;
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

-- ---------- Votaciones ----------
create or replace function emitir_voto(p_votacion uuid, p_unidad uuid, p_opcion uuid)
returns void language plpgsql security definer set search_path = public as $$
declare v votaciones;
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
  if not exists (select 1 from votacion_opciones where id = p_opcion and votacion_id = p_votacion) then
    raise exception 'Opción inválida';
  end if;
  insert into votos (votacion_id, unidad_id, opcion_id, emitido_por)
  values (p_votacion, p_unidad, p_opcion, auth.uid());   -- unique(votacion, unidad) impide votar dos veces
end $$;

-- Resultado visible para cualquier miembro (agrega votos sin exponer quién votó qué).
create or replace function resultado_votacion(p_votacion uuid)
returns table (opcion_id uuid, texto text, orden smallint, unidades bigint, peso_pct numeric)
language plpgsql stable security definer set search_path = public as $$
declare v votaciones; n_unidades integer;
begin
  select * into v from votaciones where id = p_votacion;
  if not found or not es_miembro(v.condominio_id) then raise exception 'Sin permiso'; end if;
  select count(*) into n_unidades from unidades where condominio_id = v.condominio_id;
  return query
    select o.id, o.texto, o.orden, count(vt.id),
           case when v.ponderacion = 'alicuota' then coalesce(sum(u.alicuota), 0)
                else round(100.0 * count(vt.id) / nullif(n_unidades, 0), 4) end
      from votacion_opciones o
      left join votos vt on vt.opcion_id = o.id
      left join unidades u on u.id = vt.unidad_id
     where o.votacion_id = p_votacion
     group by o.id, o.texto, o.orden
     order by o.orden;
end $$;

-- Cierra la votación. Convención: la opción de orden 0 es "Aprobar".
-- Si está ligada a una partida especial, la marca aprobada o rechazada.
create or replace function cerrar_votacion(p_votacion uuid)
returns boolean language plpgsql security definer set search_path = public as $$
declare v votaciones; v_peso numeric; v_aprobada boolean;
begin
  select * into v from votaciones where id = p_votacion for update;
  if not found then raise exception 'Votación no existe'; end if;
  if not es_junta(v.condominio_id) then raise exception 'Sin permiso'; end if;
  if v.estado <> 'abierta' then raise exception 'La votación no está abierta'; end if;
  select r.peso_pct into v_peso from resultado_votacion(p_votacion) r where r.orden = 0;
  v_aprobada := coalesce(v_peso, 0) >= v.umbral_aprobacion_pct;
  update votaciones set estado = 'cerrada', cierra_en = coalesce(cierra_en, now()) where id = p_votacion;
  if v.partida_id is not null then
    update partidas_especiales set estado = case when v_aprobada then 'aprobada' else 'rechazada' end::estado_partida
     where id = v.partida_id;
  end if;
  return v_aprobada;
end $$;

-- ---------- Reportes (con opción anónima) ----------
create or replace function crear_reporte(
  p_condominio uuid, p_categoria categoria_reporte, p_titulo text, p_descripcion text,
  p_ubicacion text, p_anonimo boolean, p_visibilidad visibilidad_reporte, p_fotos text[] default '{}'
) returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_hoy integer; f text;
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  -- Límite anti-abuso: 5 reportes por persona cada 24 h (cuenta también los anónimos).
  select count(*) into v_hoy from reportes_autoria_privada a
    where a.usuario_id = auth.uid() and a.creado_en > now() - interval '24 hours';
  if v_hoy >= 5 then raise exception 'Límite de 5 reportes por día alcanzado'; end if;

  insert into reportes (condominio_id, categoria, titulo, descripcion, ubicacion, anonimo, autor_id, visibilidad)
  values (p_condominio, p_categoria, p_titulo, p_descripcion, p_ubicacion, p_anonimo,
          case when p_anonimo then null else auth.uid() end, p_visibilidad)
  returning id into v_id;
  insert into reportes_autoria_privada (reporte_id, usuario_id) values (v_id, auth.uid());
  foreach f in array coalesce(p_fotos, '{}') loop
    insert into reporte_fotos (reporte_id, path) values (v_id, f);
  end loop;
  return v_id;
end $$;

-- El autor de un reporte anónimo puede seguir su caso sin revelarse a la junta.
create or replace function mis_reportes()
returns setof reportes language sql stable security definer set search_path = public as $$
  select r.* from reportes r join reportes_autoria_privada a on a.reporte_id = r.id
   where a.usuario_id = auth.uid() order by r.creado_en desc;
$$;

create or replace function reportes_tocar() returns trigger language plpgsql as $$
begin new.actualizado_en := now(); return new; end $$;
create trigger reportes_bu before update on reportes for each row execute function reportes_tocar();

-- ---------- Bitácora ----------
create or replace function registrar_bitacora() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (coalesce(new.condominio_id, old.condominio_id), tg_table_name, coalesce(new.id, old.id), tg_op,
          auth.uid(),
          case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end,
          case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end);
  return coalesce(new, old);
end $$;
create trigger bitacora_pagos   after insert or update or delete on pagos   for each row execute function registrar_bitacora();
create trigger bitacora_gastos  after insert or update or delete on gastos  for each row execute function registrar_bitacora();
create trigger bitacora_cargos  after insert or update or delete on cargos  for each row execute function registrar_bitacora();
create trigger bitacora_partidas after insert or update or delete on partidas_especiales for each row execute function registrar_bitacora();

-- =====================================================================
-- RLS
-- =====================================================================
alter table condominios enable row level security;
alter table perfiles enable row level security;
alter table unidades enable row level security;
alter table membresias enable row level security;
alter table cuentas_financieras enable row level security;
alter table tasas_bcv enable row level security;
alter table proveedores enable row level security;
alter table partidas_especiales enable row level security;
alter table gastos enable row level security;
alter table recibos enable row level security;
alter table cargos enable row level security;
alter table pagos enable row level security;
alter table votaciones enable row level security;
alter table votacion_opciones enable row level security;
alter table votos enable row level security;
alter table reportes enable row level security;
alter table reportes_autoria_privada enable row level security;  -- sin políticas: nadie la lee desde la app
alter table reporte_fotos enable row level security;
alter table reporte_comentarios enable row level security;
alter table avisos enable row level security;
alter table bitacora enable row level security;

create policy ver on condominios for select using (es_miembro(id));
create policy editar on condominios for update using (tiene_rol(id, array['presidente','administrador']::rol_condominio[]));

create policy ver on perfiles for select using (
  id = auth.uid() or exists (
    select 1 from membresias a join membresias b on a.condominio_id = b.condominio_id
     where a.usuario_id = auth.uid() and b.usuario_id = perfiles.id));
create policy crear on perfiles for insert with check (id = auth.uid());
create policy editar on perfiles for update using (id = auth.uid());

create policy ver on unidades for select using (es_miembro(condominio_id));
create policy gestionar on unidades for all using (es_junta(condominio_id)) with check (es_junta(condominio_id));

create policy ver on membresias for select using (usuario_id = auth.uid() or es_junta(condominio_id));
create policy gestionar on membresias for all
  using (tiene_rol(condominio_id, array['presidente','administrador']::rol_condominio[]))
  with check (tiene_rol(condominio_id, array['presidente','administrador']::rol_condominio[]));

create policy ver on cuentas_financieras for select using (es_miembro(condominio_id));
create policy gestionar on cuentas_financieras for all using (maneja_finanzas(condominio_id)) with check (maneja_finanzas(condominio_id));

create policy ver on tasas_bcv for select using (auth.uid() is not null);
create policy cargar on tasas_bcv for insert with check (
  exists (select 1 from membresias m where m.usuario_id = auth.uid()
           and m.rol in ('presidente','tesorero','administrador') and m.activo));

create policy junta on proveedores for all using (es_junta(condominio_id)) with check (maneja_finanzas(condominio_id));

create policy ver on partidas_especiales for select using (
  es_junta(condominio_id) or (estado <> 'borrador' and es_miembro(condominio_id)));
create policy gestionar on partidas_especiales for all using (es_junta(condominio_id)) with check (es_junta(condominio_id));

-- Transparencia: todos los miembros ven la relación de gastos (y su factura).
create policy ver on gastos for select using (es_miembro(condominio_id));
create policy gestionar on gastos for all using (maneja_finanzas(condominio_id)) with check (maneja_finanzas(condominio_id));

create policy ver on recibos for select using (es_junta(condominio_id) or es_de_mi_unidad(unidad_id));
create policy ver on cargos for select using (es_junta(condominio_id) or es_de_mi_unidad(unidad_id));
create policy ajustar on cargos for insert with check (maneja_finanzas(condominio_id) and tipo in ('ajuste','multa'));

create policy ver on pagos for select using (es_junta(condominio_id) or es_de_mi_unidad(unidad_id));
create policy reportar on pagos for insert with check (es_de_mi_unidad(unidad_id) or maneja_finanzas(condominio_id));
-- Sin política de UPDATE: confirmar/rechazar solo vía confirmar_pago() / rechazar_pago().

create policy ver on votaciones for select using (
  es_junta(condominio_id) or (estado <> 'borrador' and es_miembro(condominio_id)));
create policy gestionar on votaciones for all using (es_junta(condominio_id)) with check (es_junta(condominio_id));
create policy ver on votacion_opciones for select using (
  exists (select 1 from votaciones v where v.id = votacion_id));
create policy gestionar on votacion_opciones for all using (
  exists (select 1 from votaciones v where v.id = votacion_id and es_junta(v.condominio_id)));
-- Cada unidad ve su propio voto; la junta ve el registro completo (para el acta).
create policy ver on votos for select using (
  es_de_mi_unidad(unidad_id) or exists (select 1 from votaciones v where v.id = votacion_id and es_junta(v.condominio_id)));
-- Sin INSERT directo: solo emitir_voto().

create policy ver on reportes for select using (
  es_junta(condominio_id) or autor_id = auth.uid()
  or (visibilidad = 'comunidad' and es_miembro(condominio_id)));
create policy gestionar on reportes for update using (es_junta(condominio_id)) with check (es_junta(condominio_id));
-- Sin INSERT directo: solo crear_reporte().

create policy ver on reporte_fotos for select using (exists (select 1 from reportes r where r.id = reporte_id));
create policy ver on reporte_comentarios for select using (exists (select 1 from reportes r where r.id = reporte_id));
create policy comentar on reporte_comentarios for insert with check (
  autor_id = auth.uid() and exists (
    select 1 from reportes r where r.id = reporte_id
       and (not es_oficial or es_junta(r.condominio_id))));

create policy ver on avisos for select using (es_miembro(condominio_id));
create policy gestionar on avisos for all using (es_junta(condominio_id)) with check (es_junta(condominio_id));

create policy ver on bitacora for select using (maneja_finanzas(condominio_id));

-- Las funciones de negocio se ejecutan con el usuario autenticado.
revoke all on function generar_recibos(uuid, date), confirmar_pago(uuid, uuid), rechazar_pago(uuid, text),
  emitir_voto(uuid, uuid, uuid), cerrar_votacion(uuid), crear_reporte(uuid, categoria_reporte, text, text, text, boolean, visibilidad_reporte, text[]),
  mis_reportes(), resultado_votacion(uuid) from public;
grant execute on function generar_recibos(uuid, date), confirmar_pago(uuid, uuid), rechazar_pago(uuid, text),
  emitir_voto(uuid, uuid, uuid), cerrar_votacion(uuid), crear_reporte(uuid, categoria_reporte, text, text, text, boolean, visibilidad_reporte, text[]),
  mis_reportes(), resultado_votacion(uuid) to authenticated;
