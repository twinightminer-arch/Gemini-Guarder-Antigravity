[CmdletBinding()]
param([Parameter(Mandatory)][ValidateSet('register','start','stop','remove')][string]$Action)
$ErrorActionPreference = 'Stop'
$name = 'GeminiGuarder-Antigravity'
$description = 'Gemini Guarder Antigravity companion (per-user)'
$worker = Join-Path $PSScriptRoot 'daemon-worker.ps1'
$task = Get-ScheduledTask -TaskName $name -TaskPath '\' -ErrorAction SilentlyContinue
if ($task -and $task.Description -ne $description) { throw 'The scheduled task name belongs to another application.' }
switch ($Action) {
    'register' {
        $user = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
        $powershell = Join-Path $env:WINDIR 'System32/WindowsPowerShell/v1.0/powershell.exe'
        $node = (Get-Command node.exe -ErrorAction Stop).Source
        $arguments = '-NoLogo -NoProfile -NonInteractive -WindowStyle Hidden -File "' + $worker + '" -Node "' + $node + '"'
        $taskAction = New-ScheduledTaskAction -Execute $powershell -Argument $arguments -WorkingDirectory $PSScriptRoot
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $user
        $principal = New-ScheduledTaskPrincipal -UserId $user -LogonType Interactive -RunLevel Limited
        $settings = New-ScheduledTaskSettingsSet -MultipleInstances IgnoreNew -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit ([TimeSpan]::Zero) -RestartCount 10 -RestartInterval (New-TimeSpan -Minutes 1)
        Register-ScheduledTask -TaskName $name -TaskPath '\' -Description $description -Action $taskAction -Trigger $trigger -Principal $principal -Settings $settings -Force | Out-Null
    }
    'start' { Start-ScheduledTask -TaskName $name -TaskPath '\' }
    'stop' {
        if ($task -and $task.State -eq 'Running') { Stop-ScheduledTask -TaskName $name -TaskPath '\' }
    }
    'remove' { if ($task) { Unregister-ScheduledTask -TaskName $name -TaskPath '\' -Confirm:$false } }
}
