# Descarga el fondo del arbol de Legacy del cliente (SOLO LECTURA, a traves de wow.tools.local en modo local) y lo recorta.
#
# El cliente dibuja Legacy con atlas (addon Blizzard_LegacySystem): el fondo de la pagina es el atlas
# "legacy-tree-frame-background-c60" (UiTextureAtlasMember 41343, atlas 4214 = FileDataID 8281588, 1024x512, 1x).
# Aqui se baja esa textura y se recorta el panel interior (sin el marco ni la cabecera) a
#   data/forever/<build>/backgrounds/LegacyTree-Panel.png
#
# Uso (con wow.tools.local arrancado):  powershell -File tools/extract/fetch-legacy-background.ps1 [build]
param([string]$Build = "1.60.1.70707", [string]$Base = "http://localhost:5000")
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Drawing
$root = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$out = Join-Path $root "data\forever\$Build\backgrounds"
New-Item -ItemType Directory -Force $out | Out-Null
$tmp = Join-Path ([System.IO.Path]::GetTempPath()) "wfuc-legacy-atlas.png"
Invoke-WebRequest -Uri "$Base/casc/blp2png?filedataid=8281588" -OutFile $tmp -UseBasicParsing
$atlas = [System.Drawing.Bitmap]::FromFile($tmp)
try {
  if ($atlas.Width -ne 1024 -or $atlas.Height -ne 512) { throw "Atlas inesperado: $($atlas.Width)x$($atlas.Height)" }
  # Panel interior del fondo (el fondo ocupa (1,1)-(814,511) del atlas; el marco queda fuera de este recorte)
  $rect = New-Object System.Drawing.Rectangle(128, 68, 676, 433)
  $crop = $atlas.Clone($rect, $atlas.PixelFormat)
  try { $crop.Save((Join-Path $out "LegacyTree-Panel.png"), [System.Drawing.Imaging.ImageFormat]::Png) } finally { $crop.Dispose() }
} finally { $atlas.Dispose(); Remove-Item $tmp -ErrorAction SilentlyContinue }
Write-Host "OK: $out\LegacyTree-Panel.png"
