# =====================================================================
# ZPro Condominio · Compilar las dos APK de PRUEBA (Vecinos ZPro Junta y Vecinos ZPro)
#
# Se ejecuta en su PC (Windows) con Android Studio instalado. No abre Android Studio ni toca la pantalla.
#   1. Abra PowerShell en esta carpeta (ZENTAPRO APP\condominio\app)
#   2. Ejecute:  powershell -ExecutionPolicy Bypass -File .\compilar_apk.ps1
#      (opcional) -Instalar   → si hay un teléfono conectado por USB con "Depuración USB", las instala
#      (opcional) -UrlDescarga "https://..."  → enlace para bajar Vecinos ZPro (va en el mensaje de invitación)
#
# Resultado: ..\releases\v0.5-prueba\Vecinos-ZPro-Junta-0.5.1-prueba.apk y Vecinos-ZPro-0.5.1-prueba.apk (+ huellas SHA-256)
#
# Son APK de PRUEBA: paquete con ".prueba", firmadas con una llave SOLO DE PRUEBA (no la oficial).
# Sirven para ver la app en sus teléfonos; no se reparten a clientes ni se suben a Google Play.
# =====================================================================
param(
  [switch]$Instalar,
  [string]$UrlDescarga = ""
)
$ErrorActionPreference = "Stop"
$version = "0.5.1"
$app = $PSScriptRoot
$android = Join-Path $app "android"
$condominio = Split-Path $app -Parent
$zentapro = Split-Path $condominio -Parent

function Paso($t) { Write-Host ""; Write-Host "==> $t" -ForegroundColor Cyan }
function Falla($t) { Write-Host ""; Write-Host "X  $t" -ForegroundColor Red; exit 1 }

# ---------- 1. Herramientas ----------
Paso "Revisando herramientas"
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) { Falla "Falta Node.js 22 o más reciente: https://nodejs.org (versión LTS)" }
$vNode = [int]((& node --version).TrimStart("v").Split(".")[0])
if ($vNode -lt 22) { Falla "Node.js $vNode es muy viejo; instale Node.js 22 o más reciente (LTS) desde https://nodejs.org" }

$java = $null
$candidatosJava = @()
if ($env:JAVA_HOME) { $candidatosJava += $env:JAVA_HOME }
$candidatosJava += @(
  (Join-Path $env:ProgramFiles "Android\Android Studio\jbr"),
  (Join-Path $env:ProgramFiles "Android\Android Studio\jre"),
  (Join-Path $env:LOCALAPPDATA "Programs\Android Studio\jbr")
)
foreach ($c in $candidatosJava) { if ($c -and (Test-Path (Join-Path $c "bin\java.exe"))) { $java = $c; break } }
if (-not $java) { Falla "No encontré el Java de Android Studio. Instale Android Studio (https://developer.android.com/studio) o defina JAVA_HOME." }
$env:JAVA_HOME = $java
Write-Host "   Java: $java"

$sdk = $null
foreach ($c in @($env:ANDROID_HOME, $env:ANDROID_SDK_ROOT, (Join-Path $env:LOCALAPPDATA "Android\Sdk"))) {
  if ($c -and (Test-Path (Join-Path $c "platforms"))) { $sdk = $c; break }
}
if (-not $sdk) { Falla "No encontré el SDK de Android. Abra Android Studio una vez (More Actions > SDK Manager) para instalarlo." }
$env:ANDROID_HOME = $sdk
Write-Host "   SDK de Android: $sdk"
$sdkProp = ($sdk -replace '\\', '\\') -replace ':', '\:'
Set-Content -Path (Join-Path $android "local.properties") -Value "sdk.dir=$sdkProp" -Encoding ASCII

# ---------- 2. Dependencias y app web ----------
Set-Location $app
if (-not (Test-Path (Join-Path $app "node_modules\@capacitor\cli"))) {
  Paso "Instalando dependencias (solo la primera vez, unos minutos)"
  & npm install
  if ($LASTEXITCODE -ne 0) { Falla "npm install falló" }
}
Paso "Compilando las dos ediciones de la app (admin y miembros)"
if ($UrlDescarga) { $env:URL_DESCARGA_MIEMBROS = $UrlDescarga }
& node scripts/preparar_android.mjs --prueba
if ($LASTEXITCODE -ne 0) { Falla "No se pudo preparar la app web" }

# ---------- 3. Llave de PRUEBA (se crea una sola vez y se reutiliza) ----------
$carpetaLlave = Join-Path $zentapro "_firma\llaves\condominio-prueba"
$jks = Join-Path $carpetaLlave "condominio-prueba.p12"
$propLlave = Join-Path $carpetaLlave "keystore-prueba.properties"
if (-not (Test-Path $jks)) {
  Paso "Creando la llave de PRUEBA (solo para APK de prueba; NO es la llave oficial)"
  New-Item -ItemType Directory -Force -Path $carpetaLlave | Out-Null
  $chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789".ToCharArray()
  $clave = -join (1..24 | ForEach-Object { $chars | Get-Random })
  & (Join-Path $java "bin\keytool.exe") -genkeypair -keystore $jks -storetype PKCS12 -alias condominio-prueba `
      -keyalg RSA -keysize 2048 -validity 3650 -storepass $clave -keypass $clave `
      -dname "CN=ZPro Condominio PRUEBA, O=TECHNICAL DIGITAL TD C.A., L=Caracas, C=VE"
  if ($LASTEXITCODE -ne 0) { Falla "No se pudo crear la llave de prueba" }
  $rutaJks = $jks -replace '\\', '/'
  Set-Content -Path $propLlave -Encoding ASCII -Value @(
    "# Llave SOLO DE PRUEBA de ZPro Condominio (APK con paquete .prueba). No es la llave oficial.",
    "storeFile=$rutaJks", "storeType=pkcs12", "storePassword=$clave", "keyAlias=condominio-prueba", "keyPassword=$clave")
  Write-Host "   Llave creada en $carpetaLlave"
}
Copy-Item $propLlave (Join-Path $android "keystore-prueba.properties") -Force

# ---------- 4. Compilar ----------
Paso "Compilando las APK (la primera vez descarga Gradle y tarda varios minutos)"
Set-Location $android
& .\gradlew.bat assembleAdminPrueba assembleMiembrosPrueba
if ($LASTEXITCODE -ne 0) { Falla "La compilación falló. Copie el error y envíemelo." }

# ---------- 5. Entregar ----------
$destino = Join-Path $condominio "releases\v$version-prueba"
New-Item -ItemType Directory -Force -Path $destino | Out-Null
$apks = @(
  @{ origen = "app\build\outputs\apk\admin\prueba\app-admin-prueba.apk"; nombre = "ZPro-Admin-$version-prueba.apk" },
  @{ origen = "app\build\outputs\apk\miembros\prueba\app-miembros-prueba.apk"; nombre = "ZPro-Miembros-$version-prueba.apk" }
)
$huellas = @()
foreach ($a in $apks) {
  $o = Join-Path $android $a.origen
  if (-not (Test-Path $o)) { Falla "No se generó $($a.origen)" }
  $d = Join-Path $destino $a.nombre
  Copy-Item $o $d -Force
  $h = (Get-FileHash $d -Algorithm SHA256).Hash.ToLower()
  $huellas += "$h  $($a.nombre)"
}
Set-Content -Path (Join-Path $destino "SHA256.txt") -Value $huellas -Encoding ASCII

if ($Instalar) {
  $adb = Join-Path $sdk "platform-tools\adb.exe"
  if (Test-Path $adb) {
    Paso "Instalando en el teléfono conectado"
    foreach ($a in $apks) { & $adb install -r (Join-Path $destino $a.nombre) }
  } else { Write-Host "   No encontré adb; instale las APK copiándolas al teléfono." }
}

Paso "Listo"
Write-Host "   $destino"
Get-ChildItem $destino | ForEach-Object { Write-Host ("   - {0}  ({1:N1} MB)" -f $_.Name, ($_.Length / 1MB)) }
Write-Host ""
Write-Host "   Para instalarlas: páselas al teléfono (WhatsApp a usted mismo, cable o Drive), ábralas y permita"
Write-Host "   'Instalar apps desconocidas'. Como son de prueba, Android puede advertir que el desarrollador no está verificado."
Set-Location $app
