import { Link } from 'react-router-dom';
import '../chat/chat.css';

const OPCIONES = [
  { a: '/p/cierre', t: 'Reporte y cierre del mes', d: 'Quién pagó y quién no, ingresos, gastos y saldos; PDF y Excel mes a mes' },
  { a: '/p/convivencia', t: 'Transparencia y convivencia', d: 'Publicar o no las casas con cuotas vencidas (con o sin montos), mensajes anónimos y denuncias' },
  { a: '/p/mensajes', t: 'Mensajes masivos', d: 'Avisar a todo el condominio, a una calle, a un piso o a casas elegidas' },
  { a: '/p/grupos', t: 'Grupos de casas', d: 'Calles con portón, pisos con llave, torres: para cuotas y mensajes' },
  { a: '/p/invitar', t: 'Invitar vecinos', d: 'Enlace y código QR para que cada vecino pida entrar con Vecinos ZPro' },
  { a: '/p/accesos', t: 'Accesos de vecinos', d: 'Códigos por casa, solicitudes por aprobar, miembros y roles' },
  { a: '/p/alerta', t: 'Alerta vecinal', d: 'Activar el botón SOS, casas a cada lado, vecinos inscritos y suspensiones' },
  { a: '/p/alertas', t: 'Historial de alertas', d: 'Emergencias recientes, quién respondió y cómo terminaron' },
  { a: '/p/conciliacion', t: 'Conciliación bancaria', d: 'Subir el movimiento del banco y confirmar pagos solos' },
  { a: '/p/avisos', t: 'Avisos', d: 'Publicar avisos para todos los residentes' },
  { a: '/p/unidades', t: 'Apartamentos y casas', d: 'Saldos, morosidad y estado de cuenta de cada unidad' },
  { a: '/p/partidas', t: 'Partidas especiales y votaciones', d: 'Crear partidas, abrir y cerrar votaciones' },
  { a: '/p/chat-vecinos', t: 'Chat entre vecinos', d: 'Permitir o no que las casas se escriban entre sí' },
  { a: '/p/directorio', t: 'Directorio de casas', d: 'A nombre de quién está cada casa; escribir como Junta' },
  { a: '/p/salas/nueva', t: 'Nueva sala o canal', d: 'Grupos por bloque o comisión, canal de avisos' },
  { a: '/p/documentos', t: 'Documentos', d: 'Estados de cuenta, solvencias, actas para firma y sello (PDF y Excel)' },
  { a: '/p/marca', t: 'Marca del condominio', d: 'Nombre de la asociación, logo y foto de la entrada' },
  { a: '/p/tasa', t: 'Tasa BCV', d: 'Tasa del día comprobada con dos fuentes; confirmarla si una no responde' },
  { a: '/p/zentapro', t: 'Mensualidad del servicio', d: 'Factura de Technical Digital TD y reportar su pago' },
  { a: '/cuenta', t: 'Mi cuenta', d: 'Mis datos, cambiar clave, cambiar de condominio, salir' },
];

export function Mas() {
  return (
    <nav className="tarjeta mas-lista" style={{ padding: 0, gap: 0 }}>
      {OPCIONES.map((o) => (
        <Link key={o.a} to={o.a}>
          <span><strong>{o.t}</strong><small>{o.d}</small></span>
          <span aria-hidden>›</span>
        </Link>
      ))}
    </nav>
  );
}
