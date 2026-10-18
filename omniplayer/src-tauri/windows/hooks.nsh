; NSIS hooks for the Tauri per-user installer.
; Included from Tauri's generated script (MUI + StrFunc are already loaded).
; Do not delete %USERPROFILE%\LifeworldTrace\OmniDatabase (or a legacy OmniTrace library).

!include "LogicLib.nsh"
${StrRep}

!macro NSIS_HOOK_PREINSTALL
  ; Tauri's default folder is %LOCALAPPDATA%\${PRODUCTNAME} (留痕).
  ; Stable installs stay in %LOCALAPPDATA%\LifeworldTrace. Only the untouched
  ; default is redirected; a restored install path or a chosen folder stays.
  ${If} $INSTDIR == "$LOCALAPPDATA\${PRODUCTNAME}"
    StrCpy $INSTDIR "$LOCALAPPDATA\LifeworldTrace"
    SetOutPath "$INSTDIR"
  ${EndIf}

  ; A running recorder locks the exe. Rename it aside so the new file can be
  ; written. Do not taskkill: the live process keeps the renamed image, and
  ; the next start uses the new exe. Desired-on flag in OmniDatabase is not
  ; touched. The old binary name is retired the same way.
  ${If} ${FileExists} "$INSTDIR\lifeworld_trace_input.exe"
    Delete "$INSTDIR\lifeworld_trace_input.exe.old"
    ClearErrors
    Rename "$INSTDIR\lifeworld_trace_input.exe" "$INSTDIR\lifeworld_trace_input.exe.old"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\omnitrace_input.exe"
    Delete "$INSTDIR\omnitrace_input.exe.old"
    ClearErrors
    Rename "$INSTDIR\omnitrace_input.exe" "$INSTDIR\omnitrace_input.exe.old"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Default data pointer. Never overwrite one the user already changed.
  ; Creating the folder does not modify an existing library.
  ${IfNot} ${FileExists} "$INSTDIR\data_root.json"
    CreateDirectory "$PROFILE\LifeworldTrace\OmniDatabase"
    StrCpy $R8 "$PROFILE\LifeworldTrace\OmniDatabase"
    ${StrRep} $R8 $R8 "\" "\\"
    FileOpen $R9 "$INSTDIR\data_root.json" w
    FileWrite $R9 '{"path":"'
    FileWrite $R9 $R8
    FileWrite $R9 '"}'
    FileClose $R9
  ${EndIf}

  ; Retire pre-rebrand uninstall keys so Add/Remove shows one 留痕 entry.
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\OmniTrace"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\LifeworldTrace"
!macroend

!macro NSIS_HOOK_PREUNINSTALL
  ${If} $UpdateMode <> 1
    Delete "$INSTDIR\data_root.json"
    Delete "$INSTDIR\lifeworld_trace_input.exe"
    Delete "$INSTDIR\lifeworld_trace_input.exe.old"
    Delete "$INSTDIR\omnitrace_input.exe"
    Delete "$INSTDIR\omnitrace_input.exe.old"
    Delete "$INSTDIR\LifeworldTrace.ico"
    Delete "$INSTDIR\OmniTrace.ico"
  ${EndIf}
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; OmniDatabase under %USERPROFILE%\LifeworldTrace (or legacy OmniTrace) must survive uninstall.
!macroend
