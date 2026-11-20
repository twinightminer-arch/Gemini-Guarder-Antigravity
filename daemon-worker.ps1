[CmdletBinding()]
param([Parameter(Mandatory)][string]$Node)
$ErrorActionPreference='Stop'
$root=Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity'
$stop=Join-Path $root 'stop'
$runner=Join-Path $PSScriptRoot 'run.mjs'
New-Item -Path $root -ItemType Directory -Force | Out-Null
while (-not (Test-Path -LiteralPath $stop)) {
    $process=Start-Process -FilePath $Node -ArgumentList ('"' + $runner + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'runner.log') -RedirectStandardError (Join-Path $root 'runner-error.log')
    Set-Content -LiteralPath (Join-Path $root 'launcher.pid') -Value $process.Id
    $process.WaitForExit()
    if (-not (Test-Path -LiteralPath $stop)) { Start-Sleep -Seconds 3 }
}
