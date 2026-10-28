// Prepara el proyecto Android con las DOS ediciones de la app web:
//   android/app/src/admin/assets/public     ← app compilada con VITE_SABOR=admin    (ZPro Admin)
//   android/app/src/miembros/assets/public  ← app compilada con VITE_SABOR=miembros (ZPro Miembros)
// Uso:  node scripts/preparar_android.mjs [--prueba]
// Variables opcionales: URL_DESCARGA_MIEMBROS (enlace para bajar la APK de miembros, va en el mensaje de invitación)
//                       API_URL (servidor fijo; si no, la app arranca en demostración y se conecta desde la pantalla de inicio)
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const android = path.join(raiz, 'android');
const prueba = process.argv.includes('--prueba');
const conPush = existsSync(path.join(android, 'app', 'google-services.json'));
const version = '0.5';

const correr = (cmd, env = {}) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { cwd: raiz, stdio: 'inherit', env: { ...process.env, ...env }, shell: true });
};

const comunes = {
  VITE_VERSION: prueba ? `${version}-prueba` : version,
  VITE_PUSH: conPush ? 'si' : 'no',
  ...(process.env.URL_DESCARGA_MIEMBROS ? { VITE_URL_DESCARGA_MIEMBROS: process.env.URL_DESCARGA_MIEMBROS } : {}),
  ...(process.env.API_URL ? { VITE_API_URL: process.env.API_URL } : {}),
};
if (!conPush) console.log('ℹ Sin android/app/google-services.json: la alarma suena con la app abierta; con la app cerrada hace falta Firebase.');

for (const sabor of ['miembros', 'admin']) {
  correr(`npx vite build --outDir dist-${sabor} --emptyOutDir`, { ...comunes, VITE_SABOR: sabor });
}

// Capacitor copia "dist" a main/assets/public y actualiza los complementos nativos.
rmSync(path.join(raiz, 'dist'), { recursive: true, force: true });
cpSync(path.join(raiz, 'dist-miembros'), path.join(raiz, 'dist'), { recursive: true });
correr('npx cap sync android', { ZPRO_PRUEBA: prueba ? '1' : '0' });

// Cada sabor lleva su propia app web (más los archivos de Cordova que agrega Capacitor).
const publicoMain = path.join(android, 'app', 'src', 'main', 'assets', 'public');
const cordova = readdirSync(publicoMain).filter((f) => f.startsWith('cordova'));
for (const sabor of ['miembros', 'admin']) {
  const destino = path.join(android, 'app', 'src', sabor, 'assets', 'public');
  rmSync(destino, { recursive: true, force: true });
  mkdirSync(destino, { recursive: true });
  cpSync(path.join(raiz, `dist-${sabor}`), destino, { recursive: true });
  for (const f of cordova) cpSync(path.join(publicoMain, f), path.join(destino, f));
}
rmSync(publicoMain, { recursive: true, force: true });
console.log(`\n✔ Proyecto Android listo (${prueba ? 'PRUEBA' : 'release'}${conPush ? ', con Firebase' : ''}): ediciones admin y miembros.`);
