// Funciones del teléfono (solo en la app Android/iOS): canal de alarma, notificaciones push,
// confirmación de identidad con huella/patrón y vibración. En la web todo esto se omite o tiene un reemplazo.
import { Capacitor } from '@capacitor/core';
import { api } from './data';
import { PUSH_ACTIVO } from './sabor';

export const esNativo = () => Capacitor.isNativePlatform();
export const CANAL_ALARMA = 'alarma_vecinal';

/** Crea el canal de notificaciones "Alerta vecinal" (sonido de alarma, máxima importancia) y, si hay Firebase, registra el push. */
export async function iniciarNativo() {
  if (!esNativo()) return;
  const canal = {
    id: CANAL_ALARMA, name: 'Alerta vecinal', description: 'Emergencias de sus vecinos: suena como alarma',
    importance: 5 as const, visibility: 1 as const, sound: 'alarma', vibration: true, lights: true, lightColor: '#E11D2E',
  };
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.createChannel(canal);
    await LocalNotifications.requestPermissions().catch(() => undefined);
  } catch { /* plugin no disponible */ }
  if (!PUSH_ACTIVO) return;   // Sin google-services.json, PushNotifications.register() cierra la app: solo con VITE_PUSH=si.
  try {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    await PushNotifications.createChannel(canal);
    await PushNotifications.createChannel({ id: 'general', name: 'Avisos del condominio', importance: 4, visibility: 1 });
    const permiso = await PushNotifications.requestPermissions();
    if (permiso.receive !== 'granted') return;
    await PushNotifications.addListener('registration', (t) => {
      if (api.sesion()) void api.registrarDispositivo(t.value, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android').catch(() => undefined);
      try { localStorage.setItem('zpro.push', t.value); } catch { /* nada */ }
    });
    await PushNotifications.register();
  } catch { /* sin Firebase configurado */ }
}

/** Tras iniciar sesión, vuelve a enviar el token push guardado (por si se registró antes de entrar). */
export function reenviarTokenPush() {
  if (!esNativo() || !PUSH_ACTIVO || !api.sesion()) return;
  let t: string | null = null;
  try { t = localStorage.getItem('zpro.push'); } catch { /* nada */ }
  if (t) void api.registrarDispositivo(t, Capacitor.getPlatform() === 'ios' ? 'ios' : 'android').catch(() => undefined);
}

/** Notificación local inmediata con sonido de alarma (cuando la app está en segundo plano y llega una alerta por WebSocket). */
export async function notificarAlarmaLocal(titulo: string, cuerpo: string, alertaId: string) {
  if (!esNativo()) return;
  try {
    const { LocalNotifications } = await import('@capacitor/local-notifications');
    await LocalNotifications.schedule({ notifications: [{
      id: Math.floor(Math.random() * 2_000_000_000), title: titulo, body: cuerpo, channelId: CANAL_ALARMA,
      sound: 'alarma.wav', extra: { alertaId }, ongoing: false, autoCancel: true,
    }] });
  } catch { /* nada */ }
}

/**
 * Confirma que quien usa el teléfono es su dueño: huella, rostro o, si no, patrón/PIN del teléfono.
 * Devuelve 'biometria' si se confirmó, 'no_disponible' si el teléfono no tiene bloqueo configurado
 * (entonces se pide la clave de la cuenta) o lanza error si la persona canceló o falló.
 */
export async function confirmarIdentidad(motivo: string): Promise<'biometria' | 'no_disponible'> {
  if (!esNativo()) return 'no_disponible';
  const { NativeBiometric, BiometryType } = await import('@capgo/capacitor-native-biometric');
  const disp = await NativeBiometric.isAvailable({ useFallback: true }).catch(() => ({ isAvailable: false }));
  if (!disp.isAvailable) return 'no_disponible';
  try {
    await NativeBiometric.verifyIdentity({
      reason: motivo, title: 'Confirme que es usted', subtitle: 'Alerta vecinal',
      description: 'Use su huella, rostro, patrón o PIN. Su nombre y su casa irán en la alerta.', useFallback: true,
      // Android: huella o rostro, y si no, el patrón/PIN/clave de bloqueo del teléfono.
      allowedBiometryTypes: [BiometryType.MULTIPLE, BiometryType.DEVICE_CREDENTIAL],
    });
    return 'biometria';
  } catch {
    throw new Error('No se confirmó su identidad: la alerta no se envió.');
  }
}

let vibrando: ReturnType<typeof setInterval> | null = null;
/** Vibración repetida mientras suena la alarma. */
export function vibrarAlarma(activa: boolean) {
  if (vibrando) { clearInterval(vibrando); vibrando = null; }
  if (!activa) { try { navigator.vibrate?.(0); } catch { /* nada */ } return; }
  const pulso = async () => {
    if (esNativo()) {
      try { const { Haptics } = await import('@capacitor/haptics'); await Haptics.vibrate({ duration: 900 }); } catch { /* nada */ }
    } else {
      try { navigator.vibrate?.([700, 300, 700]); } catch { /* nada */ }
    }
  };
  void pulso();
  vibrando = setInterval(() => void pulso(), 2000);
}

/** Enlaces zprocondominio://invitacion/INV-XXXXXX abren la pantalla de invitación dentro de la app. */
export async function escucharEnlaces() {
  if (!esNativo()) return;
  try {
    const { App } = await import('@capacitor/app');
    await App.addListener('appUrlOpen', ({ url }) => {
      const m = /invitacion\/([A-Za-z0-9-]{4,40})/.exec(url);
      if (m) window.location.hash = `#/invitacion/${m[1].toUpperCase()}`;
    });
  } catch { /* plugin no disponible */ }
}
