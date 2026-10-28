import type { CapacitorConfig } from '@capacitor/cli';

// ⚠ appId y nombre PROVISIONALES: confirmarlos antes de la primera versión firmada oficial.
// Cambiarlos después equivale a publicar otra app distinta (ver README del portafolio).
// Cada sabor de Android (admin / miembros) define su propio paquete y nombre en android/app/build.gradle.
//
// ZPRO_PRUEBA=1 (lo pone scripts/preparar_android.mjs para las APK de prueba): permite que la app hable con
// un servidor de prueba en la red local por http (http://192.168.x.x:8080). En la release oficial queda apagado.
const prueba = process.env.ZPRO_PRUEBA === '1';

const config: CapacitorConfig = {
  appId: 'com.zentapro.condominio',
  appName: 'ZPro Condominio',
  webDir: 'dist',
  android: { allowMixedContent: prueba },
  plugins: {
    LocalNotifications: { iconColor: '#B42318', sound: 'alarma.wav' },
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};

export default config;
