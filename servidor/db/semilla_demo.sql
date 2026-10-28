-- Datos de demostración (condominio ficticio). No usar en producción.
insert into condominios (id, nombre, rif, direccion, fondo_reserva_pct, dia_vencimiento) values
  ('00000000-0000-0000-0000-0000000000c1', 'Residencias Los Samanes (demo)', 'J-00000000-0',
   'Maracay, Aragua', 10, 5);

insert into unidades (id, condominio_id, bloque, numero, alicuota, propietario_nombre) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000c1', 'A', '11', 11, 'Familia Pérez'),
  ('00000000-0000-0000-0000-0000000000a2', '00000000-0000-0000-0000-0000000000c1', 'A', '12', 11, 'Carlos Rivas'),
  ('00000000-0000-0000-0000-0000000000a3', '00000000-0000-0000-0000-0000000000c1', 'A', '13', 13, 'Ana Gómez'),
  ('00000000-0000-0000-0000-0000000000a4', '00000000-0000-0000-0000-0000000000c1', 'A', '14', 13, 'Luis Medina'),
  ('00000000-0000-0000-0000-0000000000b1', '00000000-0000-0000-0000-0000000000c1', 'B', '31', 12, 'Rosa Herrera'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-0000000000c1', 'B', '32', 12, 'José Blanco'),
  ('00000000-0000-0000-0000-0000000000b3', '00000000-0000-0000-0000-0000000000c1', 'B', '33', 14, 'Elena Castro'),
  ('00000000-0000-0000-0000-0000000000b4', '00000000-0000-0000-0000-0000000000c1', 'B', '34', 14, 'Pedro Salas');

insert into cuentas_financieras (condominio_id, nombre, tipo, moneda, datos_pago) values
  ('00000000-0000-0000-0000-0000000000c1', 'Banco (Bs) · Pago Móvil', 'banco_bs', 'VES', 'Pago Móvil 0102 · 0414-0000000 · J-00000000-0'),
  ('00000000-0000-0000-0000-0000000000c1', 'Zelle', 'zelle', 'USD', 'condominio.demo@correo.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'Caja en divisas', 'caja', 'USD', 'Entregar al tesorero con recibo'),
  ('00000000-0000-0000-0000-0000000000c1', 'Fondo de reserva', 'fondo_reserva', 'USD', null);

insert into tasas_bcv (fecha, usd_ves) values ('2026-10-01', 200.0000), ('2026-10-27', 215.5000);

insert into gastos (condominio_id, periodo, tipo, categoria, descripcion, moneda, monto, tasa_bcv) values
  ('00000000-0000-0000-0000-0000000000c1', '2026-10-01', 'comun', 'Vigilancia', 'Servicio de vigilancia octubre', 'USD', 600, null),
  ('00000000-0000-0000-0000-0000000000c1', '2026-10-01', 'comun', 'Conserjería', 'Conserje (sueldo y bono)', 'USD', 250, null),
  ('00000000-0000-0000-0000-0000000000c1', '2026-10-01', 'comun', 'Electricidad', 'Corpoelec áreas comunes', 'VES', 21550, 215.5),
  ('00000000-0000-0000-0000-0000000000c1', '2026-10-01', 'comun', 'Mantenimiento', 'Mantenimiento bomba de agua', 'USD', 50, null);

-- Para entrar como presidente con tu usuario real (después de registrarte en la app):
-- insert into membresias (condominio_id, usuario_id, rol)
-- values ('00000000-0000-0000-0000-0000000000c1', '<tu-uuid-de-auth.users>', 'presidente');

-- En la demostración el chat entre vecinos viene encendido (en un condominio real lo enciende la junta).
update condominios set chat_vecinos = true where id = '00000000-0000-0000-0000-0000000000c1';

-- En la demostración la alerta vecinal viene activa (en un condominio real la activa la junta), con 3 casas a cada lado.
update condominios set alerta_activa = true, alerta_radio = 3 where id = '00000000-0000-0000-0000-0000000000c1';
