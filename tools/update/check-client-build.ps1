# Compara el build instalado del cliente con el build de nuestros datos. SOLO LEE (.build.info y el manifest).
# Uso:  powershell -File tools/update/check-client-build.ps1 [-Client "C:\World of Warcraft"] [-Product wow_classic_beta]
# Sale con codigo 0 si coincide, 10 si el cliente tiene un build distinto (hay parche: ver la skill forever-patch-review).
param([string]$Client = "C:\World of Warcraft", [string]$Product = "wow_classic_beta")

$repo = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$info = Join-Path $Client ".build.info"
if (-not (Test-Path $info)) { Write-Host "No existe $info" -ForegroundColor Red; exit 2 }

$rows = Get-Content $info
$cols = ($rows[0] -split '\|') | ForEach-Object { ($_ -split '!')[0] }
$iVer = [array]::IndexOf($cols, "Version"); $iProd = [array]::IndexOf($cols, "Product")
$iBuild = [array]::IndexOf($cols, "Build Key"); $iAct = [array]::IndexOf($cols, "Active")

$clientVersion = $null
foreach ($r in $rows | Select-Object -Skip 1) {
    $f = $r -split '\|'
    if ($f[$iProd] -eq $Product -and $f[$iAct] -eq "1") { $clientVersion = $f[$iVer]; $buildKey = $f[$iBuild] }
}
if (-not $clientVersion) { Write-Host "No hay fila activa de $Product en .build.info" -ForegroundColor Red; exit 2 }

$ours = Get-ChildItem (Join-Path $repo "data\forever") -Directory | Where-Object { $_.Name -notmatch "-static$" } |
        Sort-Object Name | Select-Object -Last 1
$ourBuild = if ($ours) { (Get-Content (Join-Path $ours.FullName "manifest.json") -Raw | ConvertFrom-Json).build } else { "(sin datos)" }
$dbcache = Join-Path $Client "_classic_beta_\Cache\ADB\esES\DBCache.bin"
$dbTime = if (Test-Path $dbcache) { (Get-Item $dbcache).LastWriteTime } else { "(no existe)" }

Write-Host "Cliente instalado : $clientVersion  (Build Key $buildKey)"
Write-Host "Nuestros datos    : $ourBuild"
Write-Host "DBCache.bin (hotfixes del servidor) modificado: $dbTime"
if ($clientVersion -ne $ourBuild) {
    Write-Host "PARCHE NUEVO: el cliente ($clientVersion) no coincide con los datos ($ourBuild). Sigue la skill forever-patch-review." -ForegroundColor Yellow
    exit 10
}
Write-Host "Mismo build. Si el servidor ha cambiado cosas (hotfixes), entra al juego, sal y re-exporta con HOTFIXES=1; luego diff-builds." -ForegroundColor Green
