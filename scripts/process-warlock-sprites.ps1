param([switch]$Force)
& (Join-Path $PSScriptRoot 'process-sprites.ps1') -Asset warlock -Force:$Force
exit $LASTEXITCODE
