// Correo saliente (verificación de cuenta, restablecer clave, avisos). En local se ve en Mailpit: http://localhost:8025
import nodemailer from 'nodemailer';
import type { Config } from './config.js';
import type { EnviarCorreo } from './contexto.js';

export function crearCorreo(cfg: Config): EnviarCorreo {
  const transporte = nodemailer.createTransport({
    host: cfg.SMTP_HOST, port: cfg.SMTP_PUERTO, secure: cfg.SMTP_PUERTO === 465,
    auth: cfg.SMTP_USUARIO ? { user: cfg.SMTP_USUARIO, pass: cfg.SMTP_CLAVE } : undefined,
  });
  return async (c) => {
    await transporte.sendMail({ from: cfg.CORREO_REMITENTE, to: c.para, subject: c.asunto, text: c.texto, html: c.html });
  };
}
