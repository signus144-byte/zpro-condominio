// Registro de todos los módulos de rutas (cada uno es un plugin de Fastify bajo /api/v1).
import type { FastifyPluginAsync } from 'fastify';
import rutasAuth from '../auth/rutas.js';
import rutasArchivos from '../archivos/archivos.js';
import rutasCondominio from './condominio.js';
import rutasFinanzas from './finanzas.js';
import rutasPartidas from './partidas.js';
import rutasReportes from './reportes.js';
import rutasDocumentos from './documentos.js';
import rutasMiembros from './miembros.js';
import rutasChat from './chat.js';
import rutasPlataforma from './plataforma.js';
import rutasIntegraciones from './integraciones.js';
import rutasTiempoReal from '../tiempo-real/rutas.js';
import rutasNotificaciones from './notificaciones.js';
import rutasAlertas from './alertas.js';

export const RUTAS: FastifyPluginAsync[] = [
  rutasAuth, rutasArchivos, rutasCondominio, rutasFinanzas, rutasPartidas, rutasReportes,
  rutasDocumentos, rutasMiembros, rutasChat, rutasPlataforma, rutasIntegraciones, rutasTiempoReal,
  rutasNotificaciones, rutasAlertas,
];
