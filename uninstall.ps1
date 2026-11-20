[CmdletBinding()]
param([switch]$KeepLauncher)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity'
if (-not (Test-Path -LiteralPath $root)) { return }
Set-Content -LiteralPath (Join-Path $root 'stop') -Value 'stop'
$pidFile = Join-Path $root 'launcher.pid'
if (Test-Path -LiteralPath $pidFile) {
    $launcher = 0
    if ([int]::TryParse((Get-Content -LiteralPath $pidFile -TotalCount 1), [ref]$launcher) -and $launcher -gt 0) {
        $script = Join-Path $PSScriptRoot 'run.mjs'
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$launcher"
        if ($running -and $running.CommandLine -and $running.Name -eq 'node.exe' -and $running.CommandLine.IndexOf($script,[StringComparison]::OrdinalIgnoreCase) -ge 0) {
            try { Wait-Process -Id $launcher -Timeout 18 -ErrorAction Stop } catch {
                $current = Get-CimInstance Win32_Process -Filter "ProcessId=$launcher"
                if ($current -and $current.CreationDate -eq $running.CreationDate -and $current.CommandLine -eq $running.CommandLine) {
                    Stop-Process -Id $launcher -ErrorAction Stop
                    Wait-Process -Id $launcher -Timeout 5 -ErrorAction SilentlyContinue
                }
            }
        }
    }
    Remove-Item -LiteralPath $pidFile
}
$startup = Join-Path $PSScriptRoot 'daemon-startup.ps1'
& $startup -Action stop
if (-not $KeepLauncher) { & $startup -Action remove }
$node = Get-Command node.exe -ErrorAction SilentlyContinue
if ($node) {
    & $node.Source (Join-Path $PSScriptRoot 'run.mjs') --detach
    if ($LASTEXITCODE -ne 0) { throw 'Could not detach Guarder. Restart Antigravity to remove the overlay.' }
}
if (-not $KeepLauncher) {
    $registration = Join-Path $env:USERPROFILE '.gemini/config/plugins/gemini-guarder'
    $marker = Join-Path $registration '.guarder-companion'
    if ((Test-Path -LiteralPath $marker -PathType Leaf) -and
        (Get-Content -LiteralPath $marker -TotalCount 1) -eq 'Guarder-Antigravity-Injector') {
        foreach ($relative in @('plugin.json', 'skills/gemini-guarder/SKILL.md', '.guarder-companion')) {
            $file = Join-Path $registration $relative
            if (Test-Path -LiteralPath $file -PathType Leaf) { Remove-Item -LiteralPath $file }
        }
        foreach ($folder in @((Join-Path $registration 'skills/gemini-guarder'), (Join-Path $registration 'skills'), $registration)) {
            if ((Test-Path -LiteralPath $folder -PathType Container) -and -not (Get-ChildItem -LiteralPath $folder -Force | Select-Object -First 1)) {
                Remove-Item -LiteralPath $folder
            }
        }
    }
    Write-Host 'Guarder detached. Backups and settings were kept.'
}
