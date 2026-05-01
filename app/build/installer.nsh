; installer.nsh — NSIS customInstall / customUnInstall macros
; Included automatically by electron-builder when present in the build/ folder.
;
; During install  (runs elevated — NSIS uses perMachine + allowElevation):
;   1. Try machine-wide registration (all users)
;   2. Fall back to current-user registration if that fails
;
; During uninstall:
;   Remove the virtual camera and unregister COM CLSIDs

!macro customInstall
  ; Only run if the registrar binary was bundled
  IfFileExists "$INSTDIR\resources\formatboy-cam\formatboy_cam_registrar.exe" do_install skip_install

  do_install:
    ; Attempt machine-wide (all-users) registration
    nsExec::ExecToLog '"$INSTDIR\resources\formatboy-cam\formatboy_cam_registrar.exe" install --all-users'
    Pop $0
    StrCmp $0 "0" install_ok install_fallback

  install_fallback:
    ; Fall back to current-user if all-users failed
    nsExec::ExecToLog '"$INSTDIR\resources\formatboy-cam\formatboy_cam_registrar.exe" install'
    Pop $0

  install_ok:
  skip_install:
!macroend

!macro customUnInstall
  IfFileExists "$INSTDIR\resources\formatboy-cam\formatboy_cam_registrar.exe" do_uninstall skip_uninstall

  do_uninstall:
    nsExec::ExecToLog '"$INSTDIR\resources\formatboy-cam\formatboy_cam_registrar.exe" remove --all-users --unregister-com'
    Pop $0

  skip_uninstall:
!macroend
