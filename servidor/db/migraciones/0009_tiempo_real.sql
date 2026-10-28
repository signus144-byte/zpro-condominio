-- =====================================================================
-- ZPro Condominio · 0009 Tiempo real con LISTEN/NOTIFY de PostgreSQL
-- Cada mensaje nuevo o editado avisa al servidor por el canal 'zpro_mensajes';
-- el servidor reenvía por WebSocket a quienes tienen abierta esa conversación
-- (ya autorizados con puedo_ver_conversacion al suscribirse).
-- Los cambios de estado de un pago avisan por 'zpro_pagos' (notificación push a la casa).
-- =====================================================================

create or replace function avisar_mensaje() returns trigger
language plpgsql as $$
begin
  perform pg_notify('zpro_mensajes', json_build_object(
    'op', tg_op, 'id', new.id, 'conversacion_id', new.conversacion_id, 'condominio_id', new.condominio_id)::text);
  return null;
end $$;
create trigger mensajes_avisar after insert or update on mensajes
  for each row execute function avisar_mensaje();

create or replace function avisar_pago() returns trigger
language plpgsql as $$
begin
  if new.estado is distinct from old.estado then
    perform pg_notify('zpro_pagos', json_build_object(
      'id', new.id, 'unidad_id', new.unidad_id, 'condominio_id', new.condominio_id, 'estado', new.estado)::text);
  end if;
  return null;
end $$;
create trigger pagos_avisar after update on pagos
  for each row execute function avisar_pago();
