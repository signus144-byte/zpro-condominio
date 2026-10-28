-- =====================================================================
-- ZPro Condominio · 0017 Chat entre vecinos opcional
--
-- Decisión de Dirección (27-oct-2026): el chat casa ↔ casa es OPCIONAL y lo decide la junta.
--  * Viene APAGADO en cada condominio nuevo; presidencia o la administración lo enciende.
--  * Apagado: nadie abre conversaciones nuevas entre casas y las que existían quedan
--    de solo lectura (nada se borra). Casa ↔ junta, grupos y canal de la junta siguen igual.
--  * Cada cambio queda en la bitácora.
-- =====================================================================

alter table condominios add column chat_vecinos boolean not null default false;

create or replace function chat_vecinos_activo(cid uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((select chat_vecinos from condominios where id = cid), false);
$$;

create or replace function fijar_chat_vecinos(p_condominio uuid, p_activo boolean)
returns void language plpgsql security definer set search_path = public as $$
declare previo boolean;
begin
  if not tiene_rol(p_condominio, array['presidente','administrador']::rol_condominio[]) then
    raise exception 'Solo presidencia o la administración decide sobre el chat entre vecinos';
  end if;
  select chat_vecinos into previo from condominios where id = p_condominio for update;
  if previo is not distinct from p_activo then return; end if;
  update condominios set chat_vecinos = p_activo where id = p_condominio;
  insert into bitacora (condominio_id, tabla, registro_id, accion, usuario_id, antes, despues)
  values (p_condominio, 'condominios', p_condominio, 'chat_vecinos', auth.uid(),
          jsonb_build_object('chat_vecinos', previo), jsonb_build_object('chat_vecinos', p_activo));
end $$;

-- Abrir conversación casa ↔ casa: solo si la junta habilitó el chat entre vecinos.
create or replace function abrir_directa(p_mi_unidad uuid, p_otra_unidad uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_condo uuid; v_clave text; v_id uuid;
begin
  if p_mi_unidad not in (select mis_unidades()) then raise exception 'Esa no es su unidad'; end if;
  if p_mi_unidad = p_otra_unidad then raise exception 'No puede escribirse a sí mismo'; end if;
  select condominio_id into v_condo from unidades where id = p_mi_unidad;
  if not chat_vecinos_activo(v_condo) then
    raise exception 'La junta de condominio no ha habilitado el chat entre vecinos';
  end if;
  if not exists (select 1 from unidades where id = p_otra_unidad and condominio_id = v_condo) then
    raise exception 'Esa casa no pertenece a su condominio';
  end if;
  v_clave := 'd:' || least(p_mi_unidad, p_otra_unidad) || ':' || greatest(p_mi_unidad, p_otra_unidad);
  select id into v_id from conversaciones where condominio_id = v_condo and clave_unica = v_clave;
  if v_id is null then
    insert into conversaciones (condominio_id, tipo, clave_unica, creado_por)
    values (v_condo, 'directa', v_clave, auth.uid()) returning id into v_id;
    insert into conversacion_partes (conversacion_id, unidad_id) values (v_id, p_mi_unidad), (v_id, p_otra_unidad);
  end if;
  return v_id;
end $$;

-- Escribir: con el chat entre vecinos apagado, las conversaciones casa ↔ casa son de solo lectura.
create or replace function puedo_escribir(p_conv uuid, p_unidad uuid, p_como_junta boolean) returns boolean
language plpgsql stable security definer set search_path = public as $$
declare c conversaciones;
begin
  select * into c from conversaciones where id = p_conv;
  if not found or c.archivada or not condominio_operativo(c.condominio_id) then return false; end if;
  if p_como_junta then
    return es_junta(c.condominio_id) and exists (select 1 from conversacion_partes where conversacion_id = p_conv and es_junta)
           or (c.tipo = 'canal' and es_junta(c.condominio_id));
  end if;
  if c.tipo = 'canal' or c.solo_junta_escribe then return false; end if;
  if c.tipo = 'directa' and not chat_vecinos_activo(c.condominio_id) then return false; end if;
  if p_unidad is null or p_unidad not in (select mis_unidades()) then return false; end if;
  if not exists (select 1 from conversacion_partes where conversacion_id = p_conv and unidad_id = p_unidad) then return false; end if;
  -- Si la otra casa me bloqueó, no puedo escribirle por directo.
  if c.tipo = 'directa' and exists (
       select 1 from conversacion_partes o join bloqueos_chat b on b.unidad_id = o.unidad_id and b.bloqueada_id = p_unidad
        where o.conversacion_id = p_conv and o.unidad_id <> p_unidad) then
    return false;
  end if;
  return true;
end $$;
