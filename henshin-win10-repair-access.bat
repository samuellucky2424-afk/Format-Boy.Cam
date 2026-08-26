@echo off
setlocal
title Henshin Windows 10 Repair Access

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Administrator permission is required.
  set "HENSHIN_ACCESS_SCRIPT=%~f0"
  powershell.exe -NoProfile -Command "Start-Process -FilePath $env:HENSHIN_ACCESS_SCRIPT -Verb RunAs"
  exit /b
)

echo.
echo Preparing temporary Henshin repair access...
echo This can take several minutes while Windows installs OpenSSH.
echo.

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { $publicKey='ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJ1FNvaLWv0cqZyOSjLmmQ9KjChZ7Fd8xhYjQqIZG1hj henshin-temporary-repair'; $capability=Get-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0'; if ($capability.State -ne 'Installed') { Add-WindowsCapability -Online -Name 'OpenSSH.Server~~~~0.0.1.0' | Out-Null }; Set-Service -Name sshd -StartupType Automatic; Start-Service sshd; $sshDirectory='C:\ProgramData\ssh'; $authorizedKeys=Join-Path $sshDirectory 'administrators_authorized_keys'; New-Item -ItemType Directory -Path $sshDirectory -Force | Out-Null; Set-Content -LiteralPath $authorizedKeys -Value $publicKey -Encoding ascii; & icacls.exe $authorizedKeys /inheritance:r | Out-Null; & icacls.exe $authorizedKeys /grant '*S-1-5-32-544:F' | Out-Null; & icacls.exe $authorizedKeys /grant '*S-1-5-18:F' | Out-Null; $rule=Get-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -ErrorAction SilentlyContinue; if ($null -eq $rule) { New-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -DisplayName 'OpenSSH Server' -Enabled True -Direction Inbound -Protocol TCP -Action Allow -LocalPort 22 | Out-Null } else { Set-NetFirewallRule -Name 'OpenSSH-Server-In-TCP' -Enabled True | Out-Null }; $addresses=@(Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }); $details=@('USERNAME=' + $env:USERNAME, 'COMPUTER=' + $env:COMPUTERNAME); foreach ($address in $addresses) { $details += 'REMOTE_IP=' + $address.IPAddress }; $output=Join-Path ([Environment]::GetFolderPath('Desktop')) 'Henshin-remote-access.txt'; $details | Set-Content -LiteralPath $output -Encoding ascii; Write-Host ''; Write-Host 'ACCESS READY' -ForegroundColor Green; $details | ForEach-Object { Write-Host $_ }; Write-Host ''; Write-Host ('The same information was saved to: ' + $output) } catch { Write-Host ''; Write-Host ('SETUP FAILED: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"

echo.
echo Send only USERNAME and the Wi-Fi REMOTE_IP shown above.
echo Do not send any password.
echo.
pause
endlocal
