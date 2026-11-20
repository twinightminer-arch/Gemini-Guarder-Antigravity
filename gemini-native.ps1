param([ValidateSet('show','hide','status','watch')][string]$Action,[int]$Viewport=0,[int]$X=0,[int]$Y=0,[int]$Width=0,[int]$Height=0,[int]$ControllerPid=0)
$ErrorActionPreference='Stop'
$profile=Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity/GeminiBrowser'
$path=Join-Path $env:LOCALAPPDATA 'Guarder-Antigravity/gemini-window.json'
Add-Type @'
using System;
using System.Collections.Concurrent;
using System.Threading;
using System.Runtime.InteropServices;
public static class GuarderDock {
 public static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
 public static readonly AutoResetEvent CommandReady = new AutoResetEvent(false);
 public static void ReadCommands() {
     new Thread(() => {
         string line;
         while ((line = Console.ReadLine()) != null) { Commands.Enqueue(line); CommandReady.Set(); }
     }) { IsBackground = true }.Start();
 }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int L,T,R,B; }
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; }
 [StructLayout(LayoutKind.Sequential)] struct GuiInfo {
     public int Size, Flags;
     public IntPtr Active, Focus, Capture, MenuOwner, MoveSize, Caret;
     public Rect CaretRect;
 }
 [DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr h);
 [DllImport("user32.dll")] static extern IntPtr GetSystemMenu(IntPtr h,bool revert);
 [DllImport("user32.dll")] static extern uint EnableMenuItem(IntPtr menu,uint item,uint flags);
 [DllImport("user32.dll")] static extern bool DrawMenuBar(IntPtr h);
 [DllImport("user32.dll")] public static extern bool GetClientRect(IntPtr h,out Rect r);
 [DllImport("user32.dll")] public static extern bool ClientToScreen(IntPtr h,ref Point p);
 [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h,int mode);
 [DllImport("user32.dll")] public static extern bool IsWindow(IntPtr h);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr h,System.Text.StringBuilder text,int size);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h,out uint pid);
 [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
 [DllImport("user32.dll",EntryPoint="SetWindowLongPtrW")] public static extern IntPtr SetOwner(IntPtr h,int index,IntPtr owner);
 [DllImport("user32.dll",EntryPoint="GetWindowLongPtrW")] public static extern IntPtr GetOwner(IntPtr h,int index);
 [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr h,IntPtr after,int x,int y,int w,int height,uint flags);
 public static bool MovingOrSizing(IntPtr h) {
     uint pid;
     uint thread = GetWindowThreadProcessId(h,out pid);
     var info = new GuiInfo { Size = Marshal.SizeOf(typeof(GuiInfo)) };
     return thread != 0 && GetGUIThreadInfo(thread,ref info) && info.MoveSize == h;
 }
 public static bool ConfigureFrame(IntPtr h,bool docked) {
     const int minimizeBox = 0x20000, appWindow = 0x40000, toolWindow = 0x80;
     int style = unchecked((int)GetOwner(h,-16).ToInt64());
     int extended = unchecked((int)GetOwner(h,-20).ToInt64());
     int desired = docked ? style & ~minimizeBox : style | minimizeBox;
     int desiredExtended = (extended & ~appWindow) | toolWindow;
     if (style != desired) SetOwner(h,-16,new IntPtr(desired));
     if (extended != desiredExtended) SetOwner(h,-20,new IntPtr(desiredExtended));
     IntPtr menu = GetSystemMenu(h,false);
     if (menu != IntPtr.Zero) EnableMenuItem(menu,0xF020,docked ? 1u : 0u);
     DrawMenuBar(h);
     // FRAMECHANGED | NOACTIVATE | NOZORDER | NOMOVE | NOSIZE.
     return unchecked((int)GetOwner(h,-16).ToInt64()) == desired &&
         SetWindowPos(h,IntPtr.Zero,0,0,0,0,0x0037);
 }
}
'@
[void][GuarderDock]::SetThreadDpiAwarenessContext([IntPtr](-4))
function Read-Record {
    if(Test-Path -LiteralPath $path){Get-Content -LiteralPath $path -Raw | ConvertFrom-Json}
}
function Save-Record($record) {
    # Readers and writers hold the same mutex.
    $record | ConvertTo-Json -Compress | Set-Content -LiteralPath $path -Encoding UTF8
}
function Test-WindowProcess([IntPtr]$handle,[uint32]$processId) {
    [uint32]$actualId=0
    ([GuarderDock]::GetWindowThreadProcessId($handle,[ref]$actualId) -ne 0) -and ($actualId -eq $processId)
}
function Get-Slot([IntPtr]$parent,$geometry) {
    $rect=New-Object GuarderDock+Rect
    $origin=New-Object GuarderDock+Point
    if(-not [GuarderDock]::GetClientRect($parent,[ref]$rect) -or
       -not [GuarderDock]::ClientToScreen($parent,[ref]$origin) -or $rect.R -le $rect.L){
        throw 'Could not read the host client area'
    }
    $scale=($rect.R-$rect.L)/$geometry.Viewport
    @{
        X=$origin.X+[int]($geometry.X*$scale)
        Y=$origin.Y+[int]($geometry.Y*$scale)
        Width=[int]($geometry.Width*$scale)
        Height=[int]($geometry.Height*$scale)
    }
}
function Set-Slot([IntPtr]$child,$slot) {
    # NOACTIVATE | NOZORDER.
    if(-not [GuarderDock]::SetWindowPos($child,[IntPtr]::Zero,$slot.X,$slot.Y,$slot.Width,$slot.Height,0x0014)){
        throw 'Gemini window could not be positioned'
    }
}
function Set-DockedWindow([IntPtr]$child,[IntPtr]$parent,$slot,[bool]$visible) {
    [void][GuarderDock]::SetOwner($child,-8,$parent)
    if([GuarderDock]::GetOwner($child,-8) -ne $parent){throw 'Gemini window ownership could not be set'}
    if([GuarderDock]::IsIconic($child)){[void][GuarderDock]::ShowWindow($child,9)}
    if([GuarderDock]::IsZoomed($child)){
        [void][GuarderDock]::ShowWindow($child,9)
    }
    if(-not [GuarderDock]::ConfigureFrame($child,$true)){throw 'Could not disable Gemini minimize'}
    Set-Slot $child $slot
    if($visible){
        [void][GuarderDock]::ShowWindow($child,4)
        [void][GuarderDock]::SetWindowPos($child,[IntPtr]::Zero,0,0,0,0,0x0013)
    }else{[void][GuarderDock]::ShowWindow($child,0)}
}
function Enter-Lock($mutex,[int]$timeout) {
    try{$mutex.WaitOne($timeout)}
    catch [System.Threading.AbandonedMutexException]{$true}
}
function Hide-Window($record,[IntPtr]$child) {
    if($record.geometry){
        $record.visible=$false
        $record.revision=[guid]::NewGuid().ToString()
        Save-Record $record
    }
    if(-not $record.geometry -or [GuarderDock]::GetOwner($child,-8) -ne [IntPtr]::Zero){
        [void][GuarderDock]::ShowWindow($child,0)
    }
}
function Watch-Window($controller,$mutex) {
    [GuarderDock]::ReadCommands()
    $lastSlot=$null
    $revision=$null
    $record=$null
    $recordTime=$null
    $hostWasMinimized=$false
    $lastError=$null
    while(-not $controller.HasExited){
        if(Enter-Lock $mutex 0){
            try{
                [string]$command=''
                while([GuarderDock]::Commands.TryDequeue([ref]$command)){
                    if($command -ne 'hide' -and -not $command.StartsWith('show ')){continue}
                    try{
                        $current=Read-Record
                        $handle=if($current){[IntPtr][long]$current.handle}else{[IntPtr]::Zero}
                        $hasChild=$current -and (Test-WindowProcess $handle $current.processId)
                        if($command -eq 'hide'){
                            if($hasChild){Hide-Window $current $handle;$recordTime=$null}
                            [Console]::WriteLine('hidden')
                            continue
                        }
                        $geometry=$command.Substring(5)|ConvertFrom-Json
                        $parent=if($current.parent){[IntPtr][long]$current.parent}else{[IntPtr]::Zero}
                        if(-not $hasChild -or !$current.geometry -or !$current.parentProcessId -or
                           -not (Test-WindowProcess $parent $current.parentProcessId)){
                            [Console]::WriteLine('cold')
                            continue
                        }
                        $owner=[GuarderDock]::GetOwner($handle,-8)
                        if($owner -ne $parent -and $owner -ne [IntPtr]::Zero){
                            [Console]::WriteLine('cold')
                            continue
                        }
                        if($owner -eq $parent){
                            Set-Slot $handle (Get-Slot $parent $geometry)
                            [void][GuarderDock]::ShowWindow($handle,4)
                            [void][GuarderDock]::SetWindowPos($handle,[IntPtr]::Zero,0,0,0,0,0x0013)
                        }
                        $current.geometry=$geometry
                        $current.visible=$true
                        $current.revision=[guid]::NewGuid().ToString()
                        Save-Record $current
                        $recordTime=$null
                        [Console]::WriteLine('shown')
                    }catch{
                        [Console]::Error.WriteLine($_.Exception.Message)
                        [Console]::WriteLine('failed')
                    }
                }
                $file=Get-Item -LiteralPath $path -ErrorAction SilentlyContinue
                if($file -and $recordTime -ne $file.LastWriteTimeUtc){
                    $record=Read-Record
                    $recordTime=$file.LastWriteTimeUtc
                }
                if($file -and $record.geometry){
                    if($record.revision -ne $revision){$lastSlot=$null;$revision=$record.revision}
                    $child=[IntPtr][long]$record.handle
                    $parent=[IntPtr][long]$record.parent
                    if((Test-WindowProcess $child $record.processId) -and
                       (Test-WindowProcess $parent $record.parentProcessId)){
                        if([GuarderDock]::IsIconic($parent)){
                            $hostWasMinimized=$true
                        }else{
                            $owner=[GuarderDock]::GetOwner($child,-8)
                            $slot=Get-Slot $parent $record.geometry
                            if(($hostWasMinimized -and $owner -eq $parent) -or
                               (($owner -eq $parent -or $owner -eq [IntPtr]::Zero) -and [GuarderDock]::IsIconic($child))){
                                Set-DockedWindow $child $parent $slot $record.visible
                                $lastSlot=$slot
                            }elseif($owner -eq $parent -and $record.visible -and -not [GuarderDock]::MovingOrSizing($child)){
                                $rect=New-Object GuarderDock+Rect
                                $anchor=if($lastSlot){$lastSlot}else{$slot}
                                $dragged=[GuarderDock]::GetWindowRect($child,[ref]$rect) -and
                                    ([Math]::Abs($rect.L-$anchor.X) -gt 45 -or [Math]::Abs($rect.T-$anchor.Y) -gt 45) -and
                                    ([Math]::Abs($rect.L-$slot.X) -gt 45 -or [Math]::Abs($rect.T-$slot.Y) -gt 45)
                                if($dragged -or [GuarderDock]::IsZoomed($child)){
                                    if(-not [GuarderDock]::ConfigureFrame($child,$false)){throw 'Could not enable Gemini minimize'}
                                    [void][GuarderDock]::SetOwner($child,-8,[IntPtr]::Zero)
                                    if([GuarderDock]::GetOwner($child,-8) -ne [IntPtr]::Zero){
                                        [void][GuarderDock]::ConfigureFrame($child,$true)
                                        throw 'Gemini window ownership could not be removed'
                                    }
                                }elseif($lastSlot -and ($lastSlot.X -ne $slot.X -or $lastSlot.Y -ne $slot.Y -or
                                         $lastSlot.Width -ne $slot.Width -or $lastSlot.Height -ne $slot.Height)){
                                    Set-Slot $child $slot
                                }
                                $lastSlot=$slot
                            }
                            $hostWasMinimized=$false
                        }
                    }
                }
                $lastError=$null
            }catch{
                if($_.Exception.Message -ne $lastError){
                    $lastError=$_.Exception.Message
                    [Console]::Error.WriteLine($lastError)
                }
            }finally{$mutex.ReleaseMutex()}
        }
        [void][GuarderDock]::CommandReady.WaitOne(50)
    }
}
function ChromeProcesses {
    Get-CimInstance Win32_Process -Filter "Name='chrome.exe'" | Where-Object {
        $_.CommandLine -and $_.CommandLine.Contains($profile) -and $_.CommandLine -notmatch '--type='
    }
}
function Find-Chrome {
    foreach($root in @($env:ProgramFiles,${env:ProgramFiles(x86)},$env:LOCALAPPDATA)){
        if($root){
            $candidate=Join-Path $root 'Google/Chrome/Application/chrome.exe'
            if(Test-Path -LiteralPath $candidate -PathType Leaf){return $candidate}
        }
    }
    throw 'Google Chrome was not found'
}
function Invoke-DockAction {
    $browser=@(ChromeProcesses)
    $record=Read-Record
    $child=[IntPtr]::Zero
    if($record -and $browser.ProcessId -contains $record.processId){
        $handle=[IntPtr][long]$record.handle
        [uint32]$ownerId=0
        if([GuarderDock]::IsWindow($handle)){
            [void][GuarderDock]::GetWindowThreadProcessId($handle,[ref]$ownerId)
            if($ownerId -eq $record.processId){$child=$handle}
        }
    }
    if($Action -eq 'status'){
        $label=New-Object System.Text.StringBuilder 256
        if($child -ne [IntPtr]::Zero){[void][GuarderDock]::GetWindowText($child,$label,256)}
        @{found=($child -ne [IntPtr]::Zero);visible=[GuarderDock]::IsWindowVisible($child);owned=([GuarderDock]::GetOwner($child,-8) -ne [IntPtr]::Zero);gemini=($label.ToString() -match 'Gemini')}|ConvertTo-Json -Compress
        return
    }
    if($Action -eq 'hide'){
        if($child -ne [IntPtr]::Zero){Hide-Window $record $child}
        return
    }
    $parents=@(Get-Process Antigravity | Where-Object {$_.MainWindowHandle -ne 0 -and $_.Path -eq (Join-Path $env:LOCALAPPDATA 'Programs/antigravity/Antigravity.exe')})
    if($parents.Count -ne 1){throw 'Could not uniquely identify the Antigravity window'}
    if($Viewport -le 0 -or $Width -lt 150 -or $Height -lt 120){throw 'Gemini slot is too small'}
    $parent=$parents[0].MainWindowHandle
    $geometry=@{Viewport=$Viewport;X=$X;Y=$Y;Width=$Width;Height=$Height}
    $slot=Get-Slot $parent $geometry
    $detached=$child -ne [IntPtr]::Zero -and $record.geometry -and
        $record.parentProcessId -eq $parents[0].Id -and [long]$record.parent -eq $parent.ToInt64() -and
        [GuarderDock]::GetOwner($child,-8) -eq [IntPtr]::Zero
    if($child -eq [IntPtr]::Zero){
        $chrome=Find-Chrome
        $profileArg='--user-data-dir="'+$profile+'"'
        Start-Process -FilePath $chrome -ArgumentList @($profileArg,'--profile-directory=Default','--no-first-run','--app=https://gemini.google.com/','--window-size=480,640') -WindowStyle Normal
        $deadline=[DateTime]::UtcNow.AddSeconds(20)
        do {
            Start-Sleep -Milliseconds 250
            $windows=@(ChromeProcesses | ForEach-Object {Get-Process -Id $_.ProcessId -ErrorAction SilentlyContinue} | Where-Object MainWindowHandle)
            if($windows.Count -eq 1){
                $child=$windows[0].MainWindowHandle
                $record=@{processId=$windows[0].Id}
                break
            }
        } until ([DateTime]::UtcNow -ge $deadline)
        if($child -eq [IntPtr]::Zero){throw 'Gemini Chrome window did not appear'}
    }
    if(-not $detached){Set-DockedWindow $child $parent $slot $true}
    Save-Record @{
        handle=$child.ToInt64()
        processId=$record.processId
        parent=$parent.ToInt64()
        parentProcessId=$parents[0].Id
        geometry=$geometry
        visible=$true
        revision=[guid]::NewGuid().ToString()
    }
}

$lock=[Threading.Mutex]::new($false,'Local\GuarderAntigravityGeminiWindow')
try{
    if($Action -eq 'watch'){
        if($ControllerPid -le 0){throw 'Watch requires a controller process ID'}
        $controller=Get-Process -Id $ControllerPid -ErrorAction SilentlyContinue
        if(-not $controller){return}
        $watcher=[Threading.Mutex]::new($false,'Local\GuarderAntigravityGeminiWatcher')
        try{
            if(Enter-Lock $watcher 0){
                try{Watch-Window $controller $lock}
                finally{$watcher.ReleaseMutex()}
            }
        }finally{$watcher.Dispose();$controller.Dispose()}
    }else{
        if(-not (Enter-Lock $lock 12000)){throw 'Gemini window operation timed out'}
        try{Invoke-DockAction}
        finally{$lock.ReleaseMutex()}
    }
}finally{$lock.Dispose()}

