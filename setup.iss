[Setup]
AppId=GeminiGuarder-Antigravity
AppName=Gemini Guarder for Antigravity
AppVersion=0.1.0
DefaultDirName={localappdata}\Programs\GeminiGuarder-Antigravity
PrivilegesRequired=lowest
OutputBaseFilename=GeminiGuarder-Antigravity-0.1.0-Setup
OutputDir=dist
DisableProgramGroupPage=yes
Compression=lzma2
SolidCompression=yes
[Files]
Source: "*.mjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.js"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.cjs"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.ps1"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.png"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.tsv"; DestDir: "{app}"; Flags: ignoreversion
Source: "*.css"; DestDir: "{app}"; Flags: ignoreversion
Source: "LICENSE"; DestDir: "{app}"; Flags: ignoreversion
Source: "README.md"; DestDir: "{app}"; Flags: ignoreversion
Source: "antigravity-plugin\*"; DestDir: "{app}\antigravity-plugin"; Flags: ignoreversion recursesubdirs
[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\install.ps1"" -RecoverCurrentWindow"; Flags: runhidden waituntilterminated; Check: Activate
[UninstallDelete]
Type: files; Name: "{app}\activated.txt"
[UninstallRun]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoProfile -File ""{app}\uninstall.ps1"""; Flags: runhidden waituntilterminated; RunOnceId: "DetachGuarder"; Check: WasActivated
[Code]
function Activate: Boolean;
var I: Integer;
begin
  Result := True;
  for I := 1 to ParamCount do
    if CompareText(ParamStr(I), '/NOACTIVATE') = 0 then Result := False;
end;

function WasActivated: Boolean;
begin
  Result := FileExists(ExpandConstant('{app}\activated.txt'));
end;
procedure CurStepChanged(Step: TSetupStep);
begin
  if (Step = ssPostInstall) and Activate then
    SaveStringToFile(ExpandConstant('{app}\activated.txt'), '1', False);
end;
