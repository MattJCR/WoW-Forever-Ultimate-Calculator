# Comprueba que el cliente de WoW no ha sido modificado (solo lee metadatos de ficheros).
# Uso:  powershell -File tools/extract/check-client-untouched.ps1 [-Since "2026-10-16 09:30"]
# Sin -Since muestra los 5 ficheros mas recientemente modificados para compararlos a mano
# con la linea base de docs/EXTRACTION.md. Solo el propio juego/launcher escribe en el cliente
# (Cache\, Logs\, WTF\, shmem): si hay cambios, deben coincidir con una sesion de juego del usuario
# (p. ej. 2026-10-16 10:51), nunca con una ejecucion de nuestras herramientas.
param([string]$Since = "", [string]$Client = "C:\World of Warcraft")

$recent = Get-ChildItem $Client -Recurse -File -Force -ErrorAction SilentlyContinue |
          Sort-Object LastWriteTime -Descending | Select-Object -First 5 FullName, LastWriteTime
$recent | Format-Table -AutoSize

if ($Since -ne "") {
    $cut = [datetime]::Parse($Since)
    $changed = $recent | Where-Object { $_.LastWriteTime -gt $cut }
    if ($changed) { Write-Host "ATENCION: hay ficheros modificados desde $Since (puede ser el juego o el launcher abiertos)" -ForegroundColor Yellow }
    else          { Write-Host "OK: nada modificado desde $Since" -ForegroundColor Green }
}
