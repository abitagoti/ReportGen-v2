!ifndef BUILD_UNINSTALLER
!include "StrFunc.nsh"
${StrStr}

Var ReportGenServiceWasRunning
Var ReportGenServiceWait
Var ReportGenServiceOutput
Var ReportGenServiceExitCode
Var ReportGenServiceMatch
Var ReportGenServiceStopSucceeded

Function ReportGenStopServiceForUpdate
  StrCpy $ReportGenServiceWasRunning "0"
  StrCpy $ReportGenServiceStopSucceeded "1"
  nsExec::ExecToStack '"$SYSDIR\sc.exe" query ReportGenServer'
  Pop $ReportGenServiceExitCode
  Pop $ReportGenServiceOutput
  ${If} $ReportGenServiceExitCode == "5"
    StrCpy $ReportGenServiceStopSucceeded "0"
    MessageBox MB_ICONSTOP|MB_OK "Windows denied access to the ReportGen background service. Run this installer as an administrator."
    Return
  ${EndIf}
  ${StrStr} $ReportGenServiceMatch "$ReportGenServiceOutput" "1060"
  ${If} $ReportGenServiceMatch != ""
    Return
  ${EndIf}
  ; If a configured service exists, always leave it running after an update,
  ; even if it had been manually stopped before this installer was launched.
  StrCpy $ReportGenServiceWasRunning "1"
  ${StrStr} $ReportGenServiceMatch "$ReportGenServiceOutput" "STOPPED"
  ${If} $ReportGenServiceMatch != ""
    Return
  ${EndIf}

  StrCpy $ReportGenServiceWait 0
  ${StrStr} $ReportGenServiceMatch "$ReportGenServiceOutput" "STOP_PENDING"
  ${If} $ReportGenServiceMatch != ""
    Goto rg_wait_for_service_stop
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\sc.exe" stop ReportGenServer'
  Pop $ReportGenServiceExitCode
  Pop $ReportGenServiceOutput
  ${If} $ReportGenServiceExitCode != "0"
    DetailPrint "Windows did not accept the normal stop request (code $ReportGenServiceExitCode)."
    Call ReportGenOfferForceStop
    Return
  ${EndIf}

  StrCpy $ReportGenServiceWait 0
  rg_wait_for_service_stop:
    Sleep 500
    nsExec::ExecToStack '"$SYSDIR\sc.exe" query ReportGenServer'
    Pop $ReportGenServiceExitCode
    Pop $ReportGenServiceOutput
    ${StrStr} $ReportGenServiceMatch "$ReportGenServiceOutput" "STOPPED"
    ${If} $ReportGenServiceMatch != ""
      Return
    ${EndIf}
    IntOp $ReportGenServiceWait $ReportGenServiceWait + 1
    ${If} $ReportGenServiceWait < 80
      Goto rg_wait_for_service_stop
    ${EndIf}
    Call ReportGenOfferForceStop
FunctionEnd

Function ReportGenOfferForceStop
  MessageBox MB_ICONEXCLAMATION|MB_YESNO|MB_DEFBUTTON2 "ReportGen's background service is still running. You can force it to stop so the update can continue. This terminates its server process tree and may interrupt requests currently being handled. Continue with force stop?" IDYES rg_force_stop IDNO rg_force_cancel
  rg_force_stop:
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\force-stop-reportgen-service.ps1" -ServiceName ReportGenServer -TimeoutSeconds 20'
    Pop $ReportGenServiceExitCode
    Pop $ReportGenServiceOutput
    ${If} $ReportGenServiceExitCode == "0"
      DetailPrint "$ReportGenServiceOutput"
      Return
    ${EndIf}
    DetailPrint "Force-stop details: $ReportGenServiceOutput"
    StrCpy $ReportGenServiceStopSucceeded "0"
    MessageBox MB_ICONSTOP|MB_OK "Windows could not confirm that the ReportGen service stopped. The update was cancelled.$\r$\n$ReportGenServiceOutput"
    Return
  rg_force_cancel:
    StrCpy $ReportGenServiceStopSucceeded "0"
    MessageBox MB_ICONINFORMATION|MB_OK "The update was cancelled. The ReportGen background service was left running."
FunctionEnd

Function ReportGenRestartServiceAfterUpdate
  ${If} $ReportGenServiceWasRunning != "1"
    Return
  ${EndIf}
  nsExec::ExecToStack '"$SYSDIR\sc.exe" start ReportGenServer'
  Pop $ReportGenServiceExitCode
  Pop $ReportGenServiceOutput
  StrCpy $ReportGenServiceWait 0
  rg_wait_for_service_start:
    nsExec::ExecToStack '"$SYSDIR\sc.exe" query ReportGenServer'
    Pop $ReportGenServiceExitCode
    Pop $ReportGenServiceOutput
    ${StrStr} $ReportGenServiceMatch "$ReportGenServiceOutput" "RUNNING"
    ${If} $ReportGenServiceMatch != ""
      StrCpy $ReportGenServiceWasRunning "0"
      DetailPrint "ReportGen background service restarted."
      Return
    ${EndIf}
    IntOp $ReportGenServiceWait $ReportGenServiceWait + 1
    ${If} $ReportGenServiceWait < 40
      Sleep 500
      Goto rg_wait_for_service_start
    ${EndIf}
    MessageBox MB_ICONEXCLAMATION|MB_OK "ReportGen was updated, but its background service did not return to Running. Check Windows Services or restart the computer."
FunctionEnd

; preInit runs before electron-builder checks for the app executable. Stop the
; NSSM service here because it uses ReportGen.exe in Electron's Node mode and
; would otherwise be mistaken for an open desktop app by that check.
!macro preInit
  ; Include the force-stop helper in the installer itself. It must be
  ; available before the existing application files are replaced.
  InitPluginsDir
  File /oname=$PLUGINSDIR\force-stop-reportgen-service.ps1 "${PROJECT_DIR}\scripts\force-stop-reportgen-service.ps1"
  ; Also run for same-version repairs/reinstalls: NSIS may not classify those
  ; as an update, but the existing service still holds ReportGen.exe open.
  Call ReportGenStopServiceForUpdate
  ${If} $ReportGenServiceStopSucceeded != "1"
    Abort
  ${EndIf}
!macroend

!macro customInstall
  Call ReportGenRestartServiceAfterUpdate
!macroend

Function .onGUIEnd
  ; Restart the service if the user closed/cancelled an update after it was stopped.
  Call ReportGenRestartServiceAfterUpdate
FunctionEnd
!endif
