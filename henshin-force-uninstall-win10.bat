@echo off
setlocal
title Henshin Windows 10 Forced Uninstall

net session >nul 2>&1
if not "%errorlevel%"=="0" (
  echo Administrator permission is required.
  set "HENSHIN_UNINSTALL_SCRIPT=%~f0"
  powershell.exe -NoProfile -Command "Start-Process -FilePath $env:HENSHIN_UNINSTALL_SCRIPT -Verb RunAs"
  exit /b
)

echo.
echo This removes the broken Henshin 2.0.26 installation without running
echo its incompatible camera registrar. Henshin application data is preserved.
echo.
choice /C YN /M "Continue with forced Henshin uninstall"
if errorlevel 2 exit /b

set "HENSHIN_UNINSTALL_SCRIPT=%~f0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "$marker='#'+' POWERSHELL'; $source=Get-Content -LiteralPath $env:HENSHIN_UNINSTALL_SCRIPT -Raw; $offset=$source.IndexOf($marker); if($offset -lt 0){throw 'Embedded repair code was not found'}; $code=$source.Substring($offset+$marker.Length); & ([scriptblock]::Create($code))"
set "HENSHIN_RESULT=%errorlevel%"

echo.
if "%HENSHIN_RESULT%"=="0" (
  echo Forced uninstall completed. You can now install Henshin 2.0.27.
) else (
  echo Forced uninstall finished with warnings. Send the report from the Desktop.
)
echo.
pause
exit /b %HENSHIN_RESULT%

# POWERSHELL
$ErrorActionPreference = 'Continue'
$reportPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'Henshin-force-uninstall-report.txt'
$failures = [System.Collections.Generic.List[string]]::new()

Start-Transcript -LiteralPath $reportPath -Force | Out-Null
Write-Host 'Henshin forced uninstall started.'
Write-Host ('Windows: ' + [Environment]::OSVersion.VersionString)

function Remove-HenshinPath {
    param([string]$LiteralPath, [string]$Description)

    if (-not $LiteralPath -or -not (Test-Path -LiteralPath $LiteralPath)) {
        return
    }

    try {
        Remove-Item -LiteralPath $LiteralPath -Recurse -Force -ErrorAction Stop
        Write-Host ('[REMOVED] ' + $Description + ': ' + $LiteralPath)
    } catch {
        $message = $Description + ': ' + $LiteralPath + ' - ' + $_.Exception.Message
        $failures.Add($message)
        Write-Host ('[FAILED] ' + $message)
    }
}

$uninstallRoots = @(
    'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
    'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall'
)

$uninstallEntries = @()
foreach ($root in $uninstallRoots) {
    if (-not (Test-Path -LiteralPath $root)) {
        continue
    }

    foreach ($key in Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue) {
        $entry = Get-ItemProperty -LiteralPath $key.PSPath -ErrorAction SilentlyContinue
        if ($entry.DisplayName -and $entry.DisplayName -match '^Henshin(?:\s|$)') {
            $uninstallEntries += [pscustomobject]@{
                KeyPath = $key.PSPath
                DisplayName = [string]$entry.DisplayName
                InstallLocation = [string]$entry.InstallLocation
                UninstallString = [string]$entry.UninstallString
            }
            Write-Host ('[FOUND] ' + $entry.DisplayName)
        }
    }
}

$installDirectories = [System.Collections.Generic.HashSet[string]]::new([StringComparer]::OrdinalIgnoreCase)
foreach ($entry in $uninstallEntries) {
    if ($entry.InstallLocation) {
        [void]$installDirectories.Add($entry.InstallLocation.TrimEnd('\'))
    }

    if ($entry.UninstallString -match '^\s*"([^\"]+\.exe)"') {
        [void]$installDirectories.Add((Split-Path -Parent $matches[1]))
    } elseif ($entry.UninstallString -match '^\s*([^\"]+?\.exe)(?:\s|$)') {
        [void]$installDirectories.Add((Split-Path -Parent $matches[1].Trim()))
    }
}

foreach ($baseDirectory in @($env:ProgramFiles, ${env:ProgramFiles(x86)})) {
    if (-not $baseDirectory -or -not (Test-Path -LiteralPath $baseDirectory)) {
        continue
    }

    foreach ($candidate in Get-ChildItem -LiteralPath $baseDirectory -Directory -Filter 'Henshin*' -ErrorAction SilentlyContinue) {
        $hasApp = Test-Path -LiteralPath (Join-Path $candidate.FullName 'HENSHIN.exe')
        $hasCamera = Test-Path -LiteralPath (Join-Path $candidate.FullName 'resources\henshin-cam')
        if ($hasApp -or $hasCamera) {
            [void]$installDirectories.Add($candidate.FullName)
        }
    }
}

Get-Process -ErrorAction SilentlyContinue |
    Where-Object { $_.ProcessName -like 'HENSHIN*' -or $_.ProcessName -like 'henshin_cam_*' -or $_.ProcessName -like 'Uninstall Henshin*' } |
    ForEach-Object {
        try {
            Stop-Process -Id $_.Id -Force -ErrorAction Stop
            Write-Host ('[STOPPED] Process ' + $_.ProcessName)
        } catch {
            $failures.Add('Could not stop process ' + $_.ProcessName)
        }
    }

foreach ($serviceName in @('FrameServerMonitor', 'FrameServer')) {
    $service = Get-Service -Name $serviceName -ErrorAction SilentlyContinue
    if ($service -and $service.Status -ne 'Stopped') {
        Stop-Service -Name $serviceName -Force -ErrorAction SilentlyContinue
    }
}

$mfClsid = '{4F8B2E01-3C7D-4A9F-B6E2-8D1C5A3F9B7E}'
$dsClsid = '{7E3A1D52-6F8B-4C2E-A5D9-3B7E1F6C8D4A}'
$videoCategory = '{860BB310-5D01-11D0-BD3B-00A0C911CE86}'

$cameraRegistryPaths = @(
    ('HKLM:\SOFTWARE\Classes\CLSID\' + $mfClsid),
    ('HKLM:\SOFTWARE\Classes\CLSID\' + $dsClsid),
    ('HKLM:\SOFTWARE\Classes\CLSID\' + $videoCategory + '\Instance\' + $dsClsid),
    ('HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\' + $mfClsid),
    ('HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\' + $dsClsid),
    ('HKLM:\SOFTWARE\Classes\WOW6432Node\CLSID\' + $videoCategory + '\Instance\' + $dsClsid),
    'HKLM:\SOFTWARE\Classes\henshin'
)

foreach ($registryPath in $cameraRegistryPaths) {
    Remove-HenshinPath -LiteralPath $registryPath -Description 'Registry entry'
}

foreach ($directory in $installDirectories) {
    $fullDirectory = [IO.Path]::GetFullPath($directory).TrimEnd('\')
    $leaf = Split-Path -Leaf $fullDirectory
    $hasMarker = (Test-Path -LiteralPath (Join-Path $fullDirectory 'HENSHIN.exe')) -or
                 (Test-Path -LiteralPath (Join-Path $fullDirectory 'resources\henshin-cam'))

    if ($leaf -like 'Henshin*' -and $hasMarker) {
        Remove-HenshinPath -LiteralPath $fullDirectory -Description 'Application directory'
    } else {
        $failures.Add('Unsafe or unverified application directory was not removed: ' + $fullDirectory)
    }
}

Remove-HenshinPath -LiteralPath (Join-Path $env:ProgramData 'HenshinCam') -Description 'Camera runtime'
Remove-HenshinPath -LiteralPath (Join-Path $env:PUBLIC 'Documents\HenshinCam') -Description 'Camera bridge'

$shortcutRoots = @(
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('Desktop'),
    [Environment]::GetFolderPath('CommonPrograms'),
    [Environment]::GetFolderPath('Programs')
)
foreach ($shortcutRoot in $shortcutRoots) {
    if (-not $shortcutRoot -or -not (Test-Path -LiteralPath $shortcutRoot)) {
        continue
    }

    Get-ChildItem -LiteralPath $shortcutRoot -Filter 'Henshin*.lnk' -Recurse -ErrorAction SilentlyContinue |
        ForEach-Object { Remove-HenshinPath -LiteralPath $_.FullName -Description 'Shortcut' }
}

foreach ($entry in $uninstallEntries) {
    Remove-HenshinPath -LiteralPath $entry.KeyPath -Description 'Uninstall entry'
}

if ($failures.Count -eq 0) {
    Write-Host '[SUCCESS] The broken Henshin installation was removed.'
} else {
    Write-Host ('[WARNING] Cleanup completed with ' + $failures.Count + ' warning(s):')
    foreach ($failure in $failures) {
        Write-Host (' - ' + $failure)
    }
}

Write-Host ('Report: ' + $reportPath)
Stop-Transcript | Out-Null

if ($failures.Count -gt 0) {
    exit 1
}
exit 0
