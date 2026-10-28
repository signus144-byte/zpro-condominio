// Plantillas de documentos con la marca del condominio (PDF y Excel).
// Uso típico (ver src/screens/Documentos.tsx):
//   const marca = await prepararMarca(await api.marca());
//   const codigo = await api.registrarDocumento({ tipo: 'estado_cuenta', formato: 'pdf', unidadId });
//   const bytes = await estadoCuentaPdf(marca, await api.estadoCuenta(unidadId), { codigo, tasaBcv });
//   await descargar(bytes, `Estado de cuenta ${etiqueta}.pdf`, MIME.pdf);
export * from './comun';
export { estadoCuentaPdf, reciboPdf, solvenciaPdf, relacionGastosPdf, actaVotacionPdf, type DatosSolvencia } from './plantillas-pdf';
export { estadoCuentaXlsx, relacionGastosXlsx, morosidadXlsx } from './plantillas-xlsx';
export { sha256, descargar, nombreArchivo, MIME } from './descarga';
