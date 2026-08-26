@echo off
setlocal

set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%~dp0"
set "MANAGER=%ROOT%\x64\AkVCamManager.exe"

if not exist "%MANAGER%" exit /b 0

echo [Henshin] Removing the Windows 10 virtual camera...
"%MANAGER%" remove-device HenshinCamera >nul 2>&1
"%MANAGER%" update >nul 2>&1

if exist "%ProgramFiles%\AkVirtualCamera\x64\AkVirtualCamera.dll" (
  start /wait "" "%SystemRoot%\System32\regsvr32.exe" /s /u "%ProgramFiles%\AkVirtualCamera\x64\AkVirtualCamera.dll"
)
if exist "%ProgramFiles%\AkVirtualCamera\x86\AkVirtualCamera.dll" (
  start /wait "" "%SystemRoot%\SysWOW64\regsvr32.exe" /s /u "%ProgramFiles%\AkVirtualCamera\x86\AkVirtualCamera.dll"
)

REM The shared akvirtualcamera runtime is intentionally retained. Another
REM application may use it; Henshin removes only its own device.
exit /b 0
