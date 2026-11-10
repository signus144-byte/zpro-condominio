-- ============================================================================
-- ZPro Condominio · 0026 El botón de emergencia se llama "Asistencia vecinal"
-- Solo cambian los textos que ve el usuario; tablas, columnas y reglas quedan igual.
-- ============================================================================

create or replace function configurar_red_alerta(p_condominio uuid, p_activa boolean, p_radio integer)
returns void language plpgsql security definer set search_path = public as $$
declare previo condominios;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración configura la asistencia vecinal';
  end if;
  select * into previo from condominios where id = p_condominio for update;
  update condominios set alerta_activa = p_activa, alerta_radio = coalesce(p_radio, alerta_radio) where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (p_condominio, 'condominios', p_condominio, 'alerta_vecinal', auth.uid(),
          jsonb_build_object('activa', previo.alerta_activa, 'radio', previo.alerta_radio),
          jsonb_build_object('activa', p_activa, 'radio', coalesce(p_radio, previo.alerta_radio)));
  if previo.alerta_activa is distinct from p_activa then
    perform notificar(array(select distinct usuario_id from membresias where condominio_id = p_condominio and activo),
      p_condominio, 'general',
      case when p_activa then 'Asistencia vecinal disponible' else 'Asistencia vecinal desactivada' end,
      case when p_activa then 'La junta activó la asistencia vecinal. Si quiere avisar o recibir avisos de emergencia de sus vecinos, inscríbase en Asistencia vecinal.'
           else 'La junta desactivó la asistencia vecinal en el condominio.' end,
      jsonb_build_object('pantalla', 'alerta'));
  end if;
end $$;

create or replace function inscribir_alerta(p_condominio uuid, p_activo boolean, p_vehiculo boolean, p_salud boolean, p_telefono text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from membresias where condominio_id = p_condominio and usuario_id = auth.uid() and activo and unidad_id is not null) then
    raise exception 'Solo los residentes con casa registrada participan en la asistencia vecinal';
  end if;
  insert into participantes_alerta (condominio_id, usuario_id, activo, tiene_vehiculo, personal_salud, telefono)
  values (p_condominio, auth.uid(), p_activo, coalesce(p_vehiculo, false), coalesce(p_salud, false), nullif(trim(p_telefono), ''))
  on conflict (condominio_id, usuario_id) do update
    set activo = excluded.activo, tiene_vehiculo = excluded.tiene_vehiculo,
        personal_salud = excluded.personal_salud, telefono = excluded.telefono;
end $$;

create or replace function suspender_de_alerta(p_condominio uuid, p_usuario uuid, p_dias integer, p_motivo text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then raise exception 'Sin permiso'; end if;
  update participantes_alerta
     set suspendido_hasta = case when p_dias > 0 then now() + make_interval(days => p_dias) end,
         motivo_suspension = case when p_dias > 0 then nullif(trim(p_motivo), '') end
   where condominio_id = p_condominio and usuario_id = p_usuario;
  if not found then raise exception 'Esa persona no participa en la asistencia vecinal'; end if;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, despues)
  values (p_condominio, 'participantes_alerta', p_usuario, case when p_dias > 0 then 'suspender' else 'reactivar' end, auth.uid(),
          jsonb_build_object('dias', p_dias, 'motivo', p_motivo));
end $$;

create or replace function motivo_no_emitir(p_condominio uuid) returns text
language plpgsql stable security definer set search_path = public as $$
declare p participantes_alerta; n integer;
begin
  if not (select alerta_activa from condominios where id = p_condominio) then return 'La junta no ha activado la asistencia vecinal'; end if;
  if not condominio_operativo(p_condominio) then return 'El condominio está suspendido'; end if;
  select * into p from participantes_alerta where condominio_id = p_condominio and usuario_id = auth.uid();
  if p.usuario_id is null or not p.activo then return 'Inscríbase en la asistencia vecinal para poder avisar'; end if;
  if p.suspendido_hasta > now() then
    return 'La junta suspendió su participación hasta el ' || to_char(p.suspendido_hasta at time zone 'America/Caracas', 'DD/MM/YYYY');
  end if;
  if exists (select 1 from alertas where emisor_id = auth.uid() and condominio_id = p_condominio and estado = 'activa') then
    return 'Ya tiene una alerta activa';
  end if;
  select count(*) into n from alertas where emisor_id = auth.uid() and creado_en > now() - interval '24 hours';
  if n >= 3 then return 'Llegó al máximo de 3 alertas en 24 horas. Si es una emergencia, llame al 911 o a la junta'; end if;
  return null;
end $$;
