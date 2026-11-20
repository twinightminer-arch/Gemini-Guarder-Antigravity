[CmdletBinding()]
param([switch]$NoLaunch,[switch]$RecoverCurrentWindow)
$ErrorActionPreference = 'Stop'
$root = Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity'
$app = Join-Path $env:LOCALAPPDATA 'Programs/antigravity'
$archive = Join-Path $app 'resources/app.asar'
$exe = Join-Path $app 'Antigravity.exe'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not (Test-Path -LiteralPath $exe) -or -not (Test-Path -LiteralPath $archive)) { throw 'Antigravity installation not found' }
$version = & $node --version
if ($LASTEXITCODE -ne 0 -or $version -notmatch '^v([0-9]+)\.' -or [int]$Matches[1] -lt 22) { throw 'Node.js 22 or newer is required' }
& $node (Join-Path $PSScriptRoot 'dictionary.mjs') --validate
if ($LASTEXITCODE -ne 0) { throw 'Dictionary validation failed' }
New-Item -ItemType Directory -Force $root | Out-Null
$hash = (Get-FileHash -LiteralPath $archive).Hash
$backup = Join-Path $root "backups/$hash"
$marker = Join-Path $backup 'verified.txt'
if (-not (Test-Path -LiteralPath $marker)) {
    New-Item -ItemType Directory -Force $backup | Out-Null
    Copy-Item -LiteralPath $archive -Destination $backup -Force
    $unpacked = Join-Path $app 'resources/app.asar.unpacked'
    if (Test-Path -LiteralPath $unpacked) {
        $destination = Join-Path $backup 'app.asar.unpacked'
        & robocopy $unpacked $destination /E /NFL /NDL /NJH /NJS | Out-Null
        if ($LASTEXITCODE -ge 8) { throw 'Failed to back up app.asar.unpacked' }
        Get-ChildItem -LiteralPath $unpacked -File -Recurse | ForEach-Object {
            $relative = $_.FullName.Substring($unpacked.Length + 1)
            if ((Get-FileHash -LiteralPath $_.FullName).Hash -ne (Get-FileHash -LiteralPath (Join-Path $destination $relative)).Hash) { throw "Backup mismatch: $relative" }
        }
    }
    if ((Get-FileHash -LiteralPath (Join-Path $backup 'app.asar')).Hash -ne $hash) { throw 'Backup hash mismatch' }
    Set-Content -LiteralPath $marker -Value $hash
}
Write-Host "Verified backup: $backup"
if ($NoLaunch) { return }
& (Join-Path $PSScriptRoot 'uninstall.ps1') -KeepLauncher
$registration = Join-Path $env:USERPROFILE '.gemini/config/plugins/gemini-guarder'
$registrationMarker = Join-Path $registration '.guarder-companion'
if ((Test-Path -LiteralPath $registration) -and ((-not (Test-Path -LiteralPath $registrationMarker -PathType Leaf)) -or
    (Get-Content -LiteralPath $registrationMarker -TotalCount 1) -ne 'Guarder-Antigravity-Injector')) {
    throw 'A different Gemini Guarder plugin directory already exists.'
}
$pluginSource = Join-Path $PSScriptRoot 'antigravity-plugin'
$skillDir = Join-Path $registration 'skills/gemini-guarder'
New-Item -ItemType Directory -Path $skillDir -Force | Out-Null
Set-Content -LiteralPath $registrationMarker -Value 'Guarder-Antigravity-Injector'
Copy-Item -LiteralPath (Join-Path $pluginSource 'skills/gemini-guarder/SKILL.md') -Destination $skillDir -Force
Copy-Item -LiteralPath (Join-Path $pluginSource 'plugin.json') -Destination $registration -Force
Write-Host 'Registered local Gemini Guarder plugin.'
$stop = Join-Path $root 'stop'
$status = Join-Path $root 'status.json'
foreach ($file in @($stop, $status)) {
    if (Test-Path -LiteralPath $file) { Remove-Item -LiteralPath $file }
}
if (-not (Get-Process Antigravity -ErrorAction SilentlyContinue)) { Start-Process -FilePath $exe -WindowStyle Normal }
$startup = Join-Path $PSScriptRoot 'daemon-startup.ps1'
& $startup -Action register
if ($RecoverCurrentWindow) { Set-Content -LiteralPath (Join-Path $root 'recover-current') -Value '1' }
& $startup -Action start
for ($i = 0; $i -lt 40; $i++) {
    if (Test-Path -LiteralPath $status) {
        try { $state = Get-Content -LiteralPath $status -Raw | ConvertFrom-Json } catch { $state = $null }
        if ($state.attached) { Write-Host 'Guarder attached. Alt+Shift+G opens the panel.'; return }
    }
    Start-Sleep -Milliseconds 500
}
Write-Warning 'Guarder is waiting for an Antigravity Hub window.'

