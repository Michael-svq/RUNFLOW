# Instala RunFlow Station en Windows: arranca al iniciar sesión (tarea programada).
# Ejecutar en PowerShell desde la carpeta empaquetada:
#   powershell -ExecutionPolicy Bypass -File install-windows.ps1
$ErrorActionPreference = 'Stop'
$node = (Get-Command node -ErrorAction SilentlyContinue).Source
if (-not $node) { Write-Error 'Instala antes Node.js 22'; exit 1 }
$dest = Join-Path $env:LOCALAPPDATA 'RunFlow Station'
if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
Copy-Item -Recurse -Path $PSScriptRoot -Destination $dest
$data = Join-Path $env:LOCALAPPDATA 'RunFlow Station Data'
$action = New-ScheduledTaskAction -Execute $node -Argument "`"$dest\main.js`"" -WorkingDirectory $dest
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $env:USERNAME
$settings = New-ScheduledTaskSettingsSet -RestartCount 99 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit 0
[Environment]::SetEnvironmentVariable('RUNFLOW_STATION_DATA', $data, 'User')
$env:RUNFLOW_STATION_DATA = $data
Register-ScheduledTask -TaskName 'RunFlow Station' -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
Start-ScheduledTask -TaskName 'RunFlow Station'
# Permite que otros equipos de la red entren (puerto 8080).
New-NetFirewallRule -DisplayName 'RunFlow Station' -Direction Inbound -Protocol TCP -LocalPort 8080 -Action Allow -ErrorAction SilentlyContinue | Out-Null
Start-Sleep -Seconds 8
& $node "$dest\main.js" info
