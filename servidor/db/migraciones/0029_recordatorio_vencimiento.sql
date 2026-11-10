-- ============================================================================
-- ZPro Condominio · 0029 Recordatorio de vencimiento a cada casa (v0.10)
-- Cada mañana (8:10): a las casas con saldo pendiente en un recibo o cuota especial
--   · 3 días antes del vencimiento: "Su recibo de noviembre vence el 05/11…"
--   · el día siguiente al vencimiento: "…venció ayer. Si ya pagó, repórtelo en Pagar."
-- Solo a la casa (nunca a otros vecinos), en tono amable, una sola vez por recibo y por momento (antes / después). Si la casa ya reportó un pago
-- que está en revisión, no se le recuerda. La junta lo puede apagar (encendido por defecto).
-- ============================================================================

alter table condominios add column recordatorio_vencimiento boolean not null default true;

alter table notificaciones drop constraint if exists notificaciones_tipo_check;
alter table notificaciones add constraint notificaciones_tipo_check check (tipo in (
  'pago_reportado', 'pago_confirmado', 'pago_rechazado', 'pagos_pendientes', 'chat_vecinos', 'general',
  'alerta', 'alerta_cerrada', 'solicitud_ingreso', 'difusion', 'cierre_mes', 'tasa_bcv', 'mensaje_anonimo', 'denuncia_anonima',
  'datos_pago', 'recordatorio_pago'));

create or replace function nombre_mes(p date) returns text language sql immutable as $$
  select (array['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'])[extract(month from p)::int]
         || ' ' || extract(year from p)::int;
$$;

create or replace function recordar_vencimientos(p_hoy date default hoy_caracas())
returns table (condominio_id uuid, avisos integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare r record; n integer; cuenta integer := 0; cid_actual uuid := null;
begin
  for r in
    with pend as (
      select x.condominio_id as cid, x.unidad_id, x.periodo, x.partida_id,
             greatest(x.monto_usd - coalesce(a.pagado, 0), 0) as falta,
             coalesce(rc.vence, x.periodo + (c.dia_vencimiento - 1)) as vence
        from cargos x
        join condominios c on c.id = x.condominio_id
        left join recibos rc on rc.id = x.recibo_id
        left join (select cargo_id, sum(monto_usd) pagado from pago_aplicaciones group by cargo_id) a on a.cargo_id = x.id
       where x.monto_usd > 0 and c.estado in ('prueba', 'activo') and c.recordatorio_vencimiento
    )
    select pend.cid, pend.unidad_id, pend.vence, min(pend.periodo) as periodo, round(sum(pend.falta), 2) as falta,
           bool_or(pend.partida_id is not null) as con_cuota_especial,
           case when pend.vence = p_hoy + 3 then 'antes' else 'despues' end as cuando
      from pend
     where pend.falta > 0.009 and (pend.vence = p_hoy + 3 or pend.vence = p_hoy - 1)
       -- si ya reportó un pago que la junta no ha revisado, no se le molesta
       and not exists (select 1 from pagos p where p.unidad_id = pend.unidad_id and p.estado = 'reportado')
     group by pend.cid, pend.unidad_id, pend.vence
     order by pend.cid
  loop
    if cid_actual is distinct from r.cid then
      if cid_actual is not null then condominio_id := cid_actual; avisos := cuenta; return next; end if;
      cid_actual := r.cid; cuenta := 0;
    end if;
    select notificar(array(
             select m.usuario_id from membresias m
              where m.condominio_id = r.cid and m.unidad_id = r.unidad_id and m.activo
                and not exists (select 1 from notificaciones k where k.usuario_id = m.usuario_id and k.condominio_id = r.cid
                                  and k.tipo = 'recordatorio_pago'
                                  and k.datos->>'vence' = r.vence::text and k.datos->>'cuando' = r.cuando)),
           r.cid, 'recordatorio_pago',
           case when r.cuando = 'antes' then 'Su recibo vence el ' || to_char(r.vence, 'DD/MM')
                else 'Su recibo venció ayer' end,
           case when r.cuando = 'antes'
             then 'Le recordamos que su recibo de ' || nombre_mes(r.periodo) || ' vence el ' || to_char(r.vence, 'DD/MM/YYYY')
                  || '. Pendiente: $' || formato_ve(r.falta) || '. Puede pagarlo desde la app, en Pagar: le calcula el monto en bolívares.'
             else 'Su recibo de ' || nombre_mes(r.periodo) || ' venció ayer y quedan $' || formato_ve(r.falta)
                  || ' pendientes. Si ya pagó, repórtelo en Pagar para que la junta lo apruebe.' end,
           jsonb_build_object('pantalla', 'pagar', 'vence', r.vence::text, 'cuando', r.cuando))
      into n;
    cuenta := cuenta + n;
  end loop;
  if cid_actual is not null then condominio_id := cid_actual; avisos := cuenta; return next; end if;
end $$;
revoke all on function recordar_vencimientos(date) from public, anon, authenticated;
grant execute on function recordar_vencimientos(date) to servicio;

create or replace function fijar_recordatorio_vencimiento(p_condominio uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_rol(p_condominio, array['presidente','administrador','tesorero']::rol_condominio[]) then
    raise exception 'Solo presidencia, tesorería o la administración cambia esta opción';
  end if;
  update condominios set recordatorio_vencimiento = p_activo where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, despues)
  values (p_condominio, 'condominios', p_condominio, 'recordatorio_vencimiento', auth.uid(), jsonb_build_object('activo', p_activo));
end $$;
grant execute on function fijar_recordatorio_vencimiento(uuid, boolean) to authenticated;
