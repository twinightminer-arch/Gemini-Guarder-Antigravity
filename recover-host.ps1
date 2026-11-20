param([switch]$CurrentWindow)
$ErrorActionPreference='Stop'
$exe=Join-Path $env:LOCALAPPDATA 'Programs/antigravity/Antigravity.exe'
$state=Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity/recovery-attempt.txt'
$windows=@(Get-Process Antigravity -ErrorAction SilentlyContinue | Where-Object {$_.Path -eq $exe -and $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle})
if($windows.Count -ne 1){return}
$p=$windows[0]
$age=([datetime]::Now-$p.StartTime).TotalSeconds
if(!$CurrentWindow -and ($age -lt 7 -or $age -gt 90)){return}
$identity="$($p.Id):$($p.StartTime.ToFileTimeUtc())"
if((Test-Path -LiteralPath $state) -and (Get-Content -LiteralPath $state -TotalCount 1) -eq $identity){return}
$record=Get-CimInstance Win32_Process -Filter "ProcessId=$($p.Id)"
if(!$record -or $record.ExecutablePath -ne $exe -or !$record.CommandLine -or $record.CommandLine -match '--remote-debugging-port|--type='){return}
Set-Content -LiteralPath $state -Value $identity
if(!$p.CloseMainWindow() -or !$p.WaitForExit(12000)){return}
Start-Process -FilePath $exe -ArgumentList @('--remote-debugging-address=127.0.0.1','--remote-debugging-port=0')
Write-Output 'Reopened verified Antigravity window with loopback debugging.'
