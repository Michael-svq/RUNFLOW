# Estudio virtual de RunFlow para Windows (Docker Desktop).
#   Estudio-RunFlow.bat  -> arrancar
#   Parar-Estudio.bat    -> parar
#   Borrar-Estudio.bat   -> borrar los datos y empezar de cero
# Solo usa Docker: no instala nada ni cambia la configuración del equipo.
param(
  [ValidateSet('arrancar', 'parar', 'borrar')]
  [string]$Accion = 'arrancar'
)

$ErrorActionPreference = 'Continue'
$Raiz = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
Set-Location $Raiz
$Compose = @('compose', '-f', 'docker-compose.estudio.yml')

function Pausa { Write-Host ''; Read-Host 'Pulsa Intro para cerrar esta ventana' | Out-Null }

Write-Host ''
Write-Host '  RunFlow · Estudio virtual' -ForegroundColor Cyan
Write-Host ''

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  Write-Host 'Falta Docker Desktop.' -ForegroundColor Yellow
  Write-Host '1. Descárgalo e instálalo (se abre la página ahora).'
  Write-Host '2. Ábrelo y espera a que diga que está en marcha.'
  Write-Host '3. Vuelve a hacer doble clic en Estudio-RunFlow.bat.'
  Start-Process 'https://www.docker.com/products/docker-desktop/'
  Pausa
  exit 1
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  $exe = Join-Path $env:ProgramFiles 'Docker\Docker\Docker Desktop.exe'
  if (Test-Path $exe) {
    Write-Host 'Abriendo Docker Desktop (puede tardar un minuto)...'
    Start-Process $exe
  }
  for ($i = 0; $i -lt 60; $i++) {
    Start-Sleep -Seconds 3
    docker info *> $null
    if ($LASTEXITCODE -eq 0) { break }
  }
  if ($LASTEXITCODE -ne 0) {
    Write-Host 'Docker no responde. Abre Docker Desktop a mano y vuelve a intentarlo.' -ForegroundColor Yellow
    Pausa
    exit 1
  }
}

if ($Accion -eq 'parar') {
  docker @Compose stop
  Write-Host 'Estudio parado. Tus datos se conservan.' -ForegroundColor Green
  Pausa
  exit 0
}
if ($Accion -eq 'borrar') {
  $ok = Read-Host 'Se borrarán todas las escaletas y datos del estudio. Escribe SI para continuar'
  if ($ok -ne 'SI') { exit 0 }
  docker @Compose down -v
  Write-Host 'Estudio borrado. La próxima vez empezará con los datos de ejemplo.' -ForegroundColor Green
  Pausa
  exit 0
}

Write-Host 'Preparando el estudio (la primera vez tarda unos minutos)...'
# --wait espera a que Docker dé por sanos los servicios (comprobación dentro
# del contenedor, sin depender de la red de Windows).
docker @Compose up -d --build --wait --wait-timeout 300
if ($LASTEXITCODE -ne 0) {
  Write-Host ''
  Write-Host 'RunFlow no ha arrancado bien. Estado y últimas líneas del registro:' -ForegroundColor Yellow
  docker @Compose ps
  docker @Compose logs --tail 60 app
  Write-Host ''
  Write-Host 'Copia todo lo de arriba para revisarlo.' -ForegroundColor Yellow
  Pausa
  exit 1
}

Start-Process 'http://localhost:8090'
Start-Process 'http://localhost:3000/entrar'
Write-Host ''
Write-Host 'Listo.' -ForegroundColor Green
Write-Host '  RunFlow ........... http://localhost:3000'
Write-Host '      email ......... demo@runflow.test'
Write-Host '      contraseña .... runflow-demo'
Write-Host '  Monitor programa .. http://localhost:8090  (cámaras, vídeos y rótulos)'
Write-Host ''
Write-Host 'Abre la escaleta «Informativo de prueba» y pulsa GO.'
Write-Host 'Para pararlo: Parar-Estudio.bat'
Pausa
