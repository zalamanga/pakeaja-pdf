$ErrorActionPreference = 'Stop'
$scriptPath = Join-Path $PSScriptRoot 'build.mjs'
& node $scriptPath
if ($LASTEXITCODE -ne 0) { throw 'Build belum selesai. Periksa pesan dari build.mjs.' }
