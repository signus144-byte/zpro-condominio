-- ============================================================================
-- ZPro Condominio · 0028 Cuentas del condominio para los vecinos (opcional)
-- Mostrar a las casas los números del condominio (cuánto entró, cuánto se gastó, saldos) es DECISIÓN de cada
-- condominio. Por defecto NO se muestra nada: cada casa ve solo lo suyo (su estado de cuenta, sus pagos, su
-- cuota en cada cuota especial). Presidencia o la administración elige:
--   'no'      → nada de las finanzas del condominio (por defecto). Tampoco el avance de las cuotas especiales.
--   'totales' → totales del mes: cobrado, gastado por categoría, fondo de reserva y avance de las cuotas especiales.
--   'detalle' → además, cada gasto (con su factura) y los saldos de las cuentas.
-- Nunca se muestra quién pagó y quién no: eso lo decide aparte la lista de cuotas vencidas (0025).
-- ============================================================================

alter table condominios
  add column finanzas_publicas text not null default 'no' check (finanzas_publicas in ('no', 'totales', 'detalle'));

create or replace function finanzas_publicas_de(p_condominio uuid) returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select finanzas_publicas from condominios where id = p_condominio), 'no');
$$;
grant execute on function finanzas_publicas_de(uuid) to authenticated;

-- Gastos: la junta siempre; los vecinos solo si el condominio publica el detalle.
drop policy ver on gastos;
create policy ver on gastos for select using (
  (es_junta(condominio_id) or (es_miembro(condominio_id) and finanzas_publicas_de(condominio_id) = 'detalle'))
  and (partida_id is null or puedo_ver_partida(partida_id)));

-- Avance de las cuotas especiales (recaudado, casas al día): la junta siempre; los vecinos si se publican los números.
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
   where p.condominio_id = p_condominio and puedo_ver_partida(p.id)
     and (es_junta(p_condominio) or es_servicio() or finanzas_publicas_de(p_condominio) <> 'no');
$$;
grant execute on function avance_partidas(uuid) to authenticated;

create or replace function fijar_finanzas_publicas(p_condominio uuid, p_modo text)
returns void language plpgsql security definer set search_path = public as $$
declare antes text;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración cambia estas opciones';
  end if;
  if p_modo not in ('no', 'totales', 'detalle') then raise exception 'Opción no válida'; end if;
  select finanzas_publicas into antes from condominios where id = p_condominio for update;
  if antes = p_modo then return; end if;
  update condominios set finanzas_publicas = p_modo where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (p_condominio, 'condominios', p_condominio, 'finanzas_publicas', auth.uid(),
          jsonb_build_object('finanzas_publicas', antes), jsonb_build_object('finanzas_publicas', p_modo));
  -- Al publicar se avisa a todos; al dejar de publicar, solo a la junta (los vecinos simplemente dejan de verlo).
  if p_modo <> 'no' then
    perform notificar(array(select distinct m.usuario_id from membresias m where m.condominio_id = p_condominio and m.activo),
      p_condominio, 'general', 'Cuentas del condominio',
      case when p_modo = 'detalle'
        then 'La junta publicó las cuentas del condominio: cuánto entró, cuánto se gastó (cada gasto con su factura) y los saldos de las cuentas. Véalas en "Cuentas del condominio".'
        else 'La junta publicó los totales del condominio: cuánto entró y cuánto se gastó cada mes, el fondo de reserva y el avance de las cuotas especiales. Véalos en "Cuentas del condominio".' end,
      jsonb_build_object('pantalla', 'finanzas'));
  else
    perform notificar(array_remove(usuarios_junta(p_condominio), auth.uid()), p_condominio, 'general', 'Cuentas del condominio',
      'Se dejaron de mostrar las cuentas del condominio a los vecinos. Cada casa sigue viendo su propio estado de cuenta.', '{}'::jsonb);
  end if;
end $$;
grant execute on function fijar_finanzas_publicas(uuid, text) to authenticated;

-- Números del mes para los vecinos, sin nada por casa. null si el condominio no los publica (la junta los ve
-- siempre, como vista previa). El mes cerrado se entrega tal como se guardó; si no, se calcula.
create or replace function finanzas_publicas(p_condominio uuid, p_periodo date)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  modo text := finanzas_publicas_de(p_condominio);
  junta boolean := es_junta(p_condominio);
  d jsonb; cerrado boolean := false; prev text;
begin
  if not es_miembro(p_condominio) then raise exception 'Sin permiso'; end if;
  if modo = 'no' and not junta then return null; end if;
  select k.datos into d from cierres_mensuales k where k.condominio_id = p_condominio and k.periodo = p_periodo;
  if d is not null then cerrado := true;
  else
    prev := coalesce(current_setting('app.servicio', true), '');
    perform set_config('app.servicio', 'on', true);
    d := reporte_mensual(p_condominio, p_periodo);
    perform set_config('app.servicio', prev, true);
  end if;
  return jsonb_build_object(
    'modo', modo, 'periodo', p_periodo, 'cerrado', cerrado,
    'cobradoUsd', coalesce((d->'resumen'->>'cobradoUsd')::numeric, 0),
    'facturadoUsd', coalesce((d->'resumen'->>'facturadoUsd')::numeric, 0),
    'gastosUsd', coalesce((d->'resumen'->>'gastosUsd')::numeric, 0),
    'gastosPorCategoria', coalesce((select jsonb_agg(jsonb_build_object('categoria', categoria, 'montoUsd', round(total, 2)) order by total desc)
                                      from (select g->>'categoria' categoria, sum((g->>'montoUsd')::numeric) total
                                              from jsonb_array_elements(coalesce(d->'gastos', '[]')) g group by 1) x), '[]'),
    'fondoReservaUsd', coalesce((d->'fondoReserva'->>'cobradoAcumUsd')::numeric, 0),
    'partidas', coalesce((select jsonb_agg(jsonb_build_object('titulo', p->>'titulo', 'presupuestoUsd', (p->>'presupuestoUsd')::numeric,
                                                              'emitidoUsd', (p->>'emitidoUsd')::numeric, 'cobradoUsd', (p->>'cobradoUsd')::numeric,
                                                              'estado', p->>'estado'))
                            from jsonb_array_elements(coalesce(d->'partidas', '[]')) p
                           where puedo_ver_partida((p->>'id')::uuid)), '[]'),
    'cuentas', case when modo = 'detalle' or junta then coalesce((select jsonb_agg(jsonb_build_object(
                    'nombre', c->>'nombre', 'moneda', c->>'moneda', 'saldoFinal', (c->>'saldoFinal')::numeric))
                  from jsonb_array_elements(coalesce(d->'cuentas', '[]')) c), '[]') end);
end $$;
grant execute on function finanzas_publicas(uuid, date) to authenticated;
