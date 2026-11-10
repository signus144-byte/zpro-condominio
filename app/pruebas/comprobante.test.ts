// Lector de comprobantes (v0.10): textos tal como los devuelve el OCR de capturas FICTICIAS de varios bancos.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { comprobarDestino, interpretarComprobante, leerMonto } from '../src/comprobante/interpretar';

const CONDO = { telefono: '04140000000', documento: 'J000000000', numeroCuenta: '01020000000000000000', bancoCodigo: '0102' };
const HOY = new Date('2026-11-10T16:00:00Z');
const leer = (t: string) => interpretarComprobante(t, HOY);

describe('montos', () => {
  it('formatos venezolano, con punto decimal y sin decimales', () => {
    assert.equal(leerMonto('2.000,00'), 2000);
    assert.equal(leerMonto('75393,22'), 75393.22);
    assert.equal(leerMonto('2,000.50'), 2000.5);
    assert.equal(leerMonto('238.00'), 238);
    assert.equal(leerMonto('1.250'), 1250);
    assert.equal(leerMonto('abc'), null);
  });
});

describe('comprobantes de distintos bancos', () => {
  it('Banesco: etiqueta y valor en el mismo renglón', () => {
    const l = leer(`Banesco   : Pago Móvil
¡Operación exitosa!
Monto
Bs. 2.000,00
Banco destino   0102   - Banco de Venezuela
Teléfono destino   0414-0000000
Cédula/RIF destino   J-00000000-0
Referencia   004512345678
Fecha   10/11/2026 09:41 a. m.
Concepto   Condominio B-33`);
    assert.deepEqual([l.referencia, l.monto, l.fecha, l.bancoOrigen, l.bancoDestino], ['004512345678', 2000, '2026-11-10', '0134', '0102']);
    assert.deepEqual(l.telefonos, ['04140000000'], 'la referencia no se confunde con un teléfono');
    assert.deepEqual(comprobarDestino(l, CONDO).distinto, []);
  });

  it('Mercantil Tpago: "Bs.S", fecha con mes en letras y "JO0…" (O por cero)', () => {
    const l = leer(`Mercantil Tpago
Pago enviado
Monto   Bs.S 2.000,00
Celular beneficiario   04140000000
Banco beneficiario   Banco de Venezuela
Documento de identidad   JO00000000
Nro. de referencia   987654
Fecha   10 nov. 2026`);
    assert.deepEqual([l.referencia, l.monto, l.fecha, l.bancoOrigen, l.bancoDestino], ['987654', 2000, '2026-11-10', '0105', '0102']);
    assert.deepEqual(l.documentos, ['J000000000']);
  });

  it('Provincial (modo oscuro): "Importe", "NO de operación", teléfono con espacios', () => {
    const l = leer(`BBVA Provincial
Pago móvil realizado
Importe   2.000,00 Bs.
NO de operación   55512345
Destinatario   0414 000 0000
Banco receptor   0102
Fecha de la operación   10-11-2026`);
    assert.deepEqual([l.referencia, l.monto, l.fecha, l.bancoOrigen, l.bancoDestino, l.telefonos[0]], ['55512345', 2000, '2026-11-10', '0108', '0102', '04140000000']);
  });

  it('BNC transferencia: cuenta de 20 dígitos y fecha AAAA-MM-DD', () => {
    const l = leer(`BNC en línea
Transferencia exitosa
Cuenta destino   0102-0000-00-0000000000
RIF   J-00000000-0
Monto   Bs. 55.467,33
Número de confirmación   77881234
Fecha   2026-11-10`);
    assert.deepEqual([l.referencia, l.monto, l.fecha, l.bancoOrigen], ['77881234', 55467.33, '2026-11-10', '0191']);
    assert.deepEqual(l.cuentas, ['01020000000000000000']);
    assert.ok(comprobarDestino(l, CONDO).coincide.includes('número de cuenta'));
  });

  it('avisa cuando el pago fue a otro teléfono, otra cédula y otro banco', () => {
    const l = leer(`BDV   - Pago Móvil
Monto:   2.000,00 Bs
Referencia:   0099887766
Banco Receptor:   0134   - BANESCO
Teléfono Receptor:   0412-9998877
Documento:   V-18.765.432
Fecha:   09/11/2026 18:20`);
    assert.equal(l.bancoDestino, '0134');
    assert.deepEqual(comprobarDestino(l, CONDO).distinto.sort(), ['RIF', 'banco', 'teléfono']);
  });

  it('con saldo, comisión y datos del que paga: toma el monto de la operación y el destino correcto', () => {
    const l = leer(`Bancamiga
Pago Móvil Interbancario
Saldo disponible   Bs. 15.230,45
Cuenta origen   0172-****-+***-1234
Teléfono origen   0424-1112233
Cédula origen   V-12.345.678
Monto de la operación   Bs. 1.250,50
Comisión   Bs. 0,38
Banco destino   0102 Banco de Venezuela
Teléfono destino   0414-0000000
RIF destino   Jo00000000
Nro. Operación   2026111000453
Fecha y hora   10/11/2026   - 11:02`);
    assert.deepEqual([l.referencia, l.monto, l.bancoOrigen, l.bancoDestino], ['2026111000453', 1250.5, '0172', '0102']);
    const d = comprobarDestino(l, CONDO);
    assert.ok(d.coincide.includes('teléfono'));
    assert.deepEqual(d.distinto, [], 'el teléfono y la cédula del que paga no cuentan como error');
  });

  it('foto con letras mal leídas ("ganesco", "ganco destino")', () => {
    const l = leer(`ganesco   : Pago Móvil
Monto
Bs. 2.000,00
ganco destino   0102   - Banco de venezuela
Teléfono destino   0414-0000000
Referencia   004512345678
F echa   10/11/2026 09:41 a. m.`);
    assert.deepEqual([l.referencia, l.monto, l.bancoOrigen, l.bancoDestino, l.fecha], ['004512345678', 2000, '0134', '0102', '2026-11-10']);
  });

  it('valores debajo de la etiqueta y fechas futuras descartadas', () => {
    const l = leer(`Monto:
2.000,00 Bs
Referencia:
0099887766
Fecha: 25/12/2026`);
    assert.deepEqual([l.referencia, l.monto, l.fecha], ['0099887766', 2000, null]);
  });

  it('una imagen sin datos de pago no inventa nada', () => {
    const l = leer('Foto de la entrada del edificio\nBienvenidos');
    assert.deepEqual([l.referencia, l.monto, l.fecha, l.bancoOrigen], [null, null, null, null]);
  });
});
