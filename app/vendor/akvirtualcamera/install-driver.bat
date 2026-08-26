@echo off
setlocal

set "ROOT=%~1"
if "%ROOT%"=="" set "ROOT=%~dp0"
set "INSTALLER=%ROOT%\akvirtualcamera-windows-9.4.1.exe"
set "MANAGER=%ROOT%\x64\AkVCamManager.exe"

echo [Henshin] Installing the Windows 10 DirectShow camera backend...

if not exist "%INSTALLER%" (
  echo [Henshin] Missing akvirtualcamera installer: %INSTALLER%
  exit /b 2
)

if not exist "%MANAGER%" (
  echo [Henshin] Missing AkVCamManager: %MANAGER%
  exit /b 3
)

start /wait "" "%INSTALLER%" /S
if errorlevel 1 (
  echo [Henshin] akvirtualcamera installation failed with code %errorlevel%.
  exit /b %errorlevel%
)

set "AK_INSTALL=%ProgramFiles%\AkVirtualCamera"
if not exist "%AK_INSTALL%\x64\AkVirtualCamera.dll" (
  echo [Henshin] Installed DirectShow filter was not found.
  exit /b 4
)

start /wait "" "%SystemRoot%\System32\regsvr32.exe" /s "%AK_INSTALL%\x64\AkVirtualCamera.dll"
if errorlevel 1 (
  echo [Henshin] x64 DirectShow registration failed with code %errorlevel%.
  exit /b %errorlevel%
)

if exist "%AK_INSTALL%\x86\AkVirtualCamera.dll" (
  start /wait "" "%SystemRoot%\SysWOW64\regsvr32.exe" /s "%AK_INSTALL%\x86\AkVirtualCamera.dll"
  if errorlevel 1 echo [Henshin] Warning: x86 DirectShow registration failed with code %errorlevel%.
)

"%MANAGER%" remove-device HenshinCamera >nul 2>&1
powershell.exe -NoProfile -Command "& $env:MANAGER add-device -i HenshinCamera ('Henshin ' + [char]0x5909 + [char]0x8EAB); exit $LASTEXITCODE"
if errorlevel 1 exit /b %errorlevel%

"%MANAGER%" add-format HenshinCamera RGB24 1280 720 30
if errorlevel 1 exit /b %errorlevel%

"%MANAGER%" update
if errorlevel 1 exit /b %errorlevel%

echo [Henshin] Windows 10 camera backend installed.
exit /b 0
