; electron-builder NSIS hooks. The package is per-machine and always elevated.
!include "WinVer.nsh"

!macro customInstall
  ${If} ${AtLeastBuild} 22000
    ; Remove a Windows 10 backend left behind by an OS upgrade.
    IfFileExists "$INSTDIR\resources\akvirtualcamera\uninstall-driver.bat" 0 +2
      nsExec::ExecToLog '"$INSTDIR\resources\akvirtualcamera\uninstall-driver.bat" "$INSTDIR\resources\akvirtualcamera"'

    IfFileExists "$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" henshin_install_camera henshin_install_missing

    henshin_install_camera:
      nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" install --all-users'
      Pop $0
      StrCmp $0 "0" henshin_install_done henshin_install_failed

    henshin_install_missing:
      MessageBox MB_OK|MB_ICONSTOP "The Henshin camera registrar is missing. Installation cannot continue."
      Abort

    henshin_install_failed:
      MessageBox MB_OK|MB_ICONSTOP "Machine-wide Henshin camera registration failed (exit code $0). Installation cannot continue."
      Abort
  ${Else}
    IfFileExists "$INSTDIR\resources\akvirtualcamera\install-driver.bat" henshin_install_ak henshin_install_ak_missing

    henshin_install_ak:
      nsExec::ExecToLog '"$INSTDIR\resources\akvirtualcamera\install-driver.bat" "$INSTDIR\resources\akvirtualcamera"'
      Pop $0
      StrCmp $0 "0" henshin_install_done henshin_install_ak_failed

    henshin_install_ak_missing:
      MessageBox MB_OK|MB_ICONSTOP "The Henshin Windows 10 camera backend is missing. Installation cannot continue."
      Abort

    henshin_install_ak_failed:
      MessageBox MB_OK|MB_ICONSTOP "The Henshin Windows 10 camera backend failed to install (exit code $0). Installation cannot continue."
      Abort
  ${EndIf}

  henshin_install_done:
!macroend

!macro customUnInstall
  ${If} ${AtLeastBuild} 22000
    IfFileExists "$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" henshin_uninstall_camera henshin_uninstall_missing

    henshin_uninstall_camera:
      nsExec::ExecToLog '"$INSTDIR\resources\henshin-cam\henshin_cam_registrar.exe" remove --all-users --unregister-com'
      Pop $0
      StrCmp $0 "0" henshin_uninstall_cleanup henshin_uninstall_failed

    henshin_uninstall_missing:
      MessageBox MB_OK|MB_ICONEXCLAMATION "The Henshin camera registrar is missing. Uninstallation will continue with camera runtime cleanup."
      Goto henshin_uninstall_cleanup

    henshin_uninstall_failed:
      MessageBox MB_OK|MB_ICONEXCLAMATION "Henshin camera deregistration failed (exit code $0). Uninstallation will continue; a restart may be required to finish camera cleanup."
      Goto henshin_uninstall_cleanup
  ${Else}
    IfFileExists "$INSTDIR\resources\akvirtualcamera\uninstall-driver.bat" 0 henshin_uninstall_cleanup
    nsExec::ExecToLog '"$INSTDIR\resources\akvirtualcamera\uninstall-driver.bat" "$INSTDIR\resources\akvirtualcamera"'
  ${EndIf}

  henshin_uninstall_cleanup:
    ; Delete only directories exclusively owned by the camera runtime.
    ReadEnvStr $2 "ProgramData"
    StrCmp $2 "" henshin_uninstall_public
    RMDir /r "$2\HenshinCam"

  henshin_uninstall_public:
    ReadEnvStr $1 "PUBLIC"
    StrCmp $1 "" henshin_uninstall_done
    RMDir /r "$1\Documents\HenshinCam"

  henshin_uninstall_done:
!macroend
