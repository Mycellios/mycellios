!define MUI_CUSTOMFUNCTION_ABORT MycelliosRollback

; The assisted wizard installs for this user only, without an elevation or
; all-users choice. Keep the existing per-user registration and profile.
!macro customInstallMode
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro MycelliosInitHelper
  InitPluginsDir
  StrCpy $MycelliosPowerShell "$SYSDIR\WindowsPowerShell\v1.0\powershell.exe"
  IfFileExists "$WINDIR\SysNative\WindowsPowerShell\v1.0\powershell.exe" 0 +2
    StrCpy $MycelliosPowerShell "$WINDIR\SysNative\WindowsPowerShell\v1.0\powershell.exe"
  File /oname=$PLUGINSDIR\mycellios-fast-install.ps1 "${PROJECT_DIR}\scripts\fast-install.ps1"
!macroend

!macro customHeader
  Var MycelliosPowerShell
  Function MycelliosRollback
    SetOutPath $TEMP
    nsExec::ExecToLog '"$MycelliosPowerShell" -NoProfile -NonInteractive -File "$PLUGINSDIR\mycellios-fast-install.ps1" -Operation rollback -Installation "$INSTDIR" -Journal "$PLUGINSDIR\mycellios-fast-install.json"'
    Pop $0
  FunctionEnd

  Function .onInstFailed
    Call MycelliosRollback
  FunctionEnd

!macroend

!macro customCheckAppRunning
  !insertmacro MycelliosInitHelper
  nsExec::ExecToLog '"$MycelliosPowerShell" -NoProfile -NonInteractive -File "$PLUGINSDIR\mycellios-fast-install.ps1" -Operation check -Installation "$INSTDIR" -Journal "$PLUGINSDIR\mycellios-fast-install.json"'
  Pop $0
  ${If} $0 != 0
    MessageBox MB_OK|MB_ICONEXCLAMATION "Cierra Mycellios desde su menú antes de actualizar. Se conservarán tus borradores y tareas." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend

!macro customInit
  !insertmacro MycelliosInitHelper
  SetOutPath $TEMP
  nsExec::ExecToLog '"$MycelliosPowerShell" -NoProfile -NonInteractive -File "$PLUGINSDIR\mycellios-fast-install.ps1" -Operation prepare -Installation "$INSTDIR" -Journal "$PLUGINSDIR\mycellios-fast-install.json" -Uninstaller "${UNINSTALL_FILENAME}" -InstallRegistryKey "${INSTALL_REGISTRY_KEY}" -UninstallRegistryKey "${UNINSTALL_REGISTRY_KEY}" -TargetVersion "${VERSION}"'
  Pop $0
  ${If} $0 != 0
    Call MycelliosRollback
    MessageBox MB_OK|MB_ICONEXCLAMATION "No se ha podido preparar una actualización recuperable. La instalación anterior se conserva." /SD IDOK
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend

!macro customInstall
  nsExec::ExecToLog '"$MycelliosPowerShell" -NoProfile -NonInteractive -File "$PLUGINSDIR\mycellios-fast-install.ps1" -Operation commit -Installation "$INSTDIR" -Journal "$PLUGINSDIR\mycellios-fast-install.json"'
  Pop $0
  ${If} $0 != 0
    Call MycelliosRollback
    SetErrorLevel 2
    Abort
  ${EndIf}
!macroend

!macro MycelliosCheckUninstall
  ${If} ${Errors}
  ${OrIf} $R0 != 0
    Call MycelliosRollback
    SetErrorLevel 2
    Quit
  ${EndIf}
!macroend

!macro customUnInstallCheck
  !insertmacro MycelliosCheckUninstall
!macroend

!macro customUnInstallCheckCurrentUser
  !insertmacro MycelliosCheckUninstall
!macroend
