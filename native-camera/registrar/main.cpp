// formatboy_cam_registrar.exe
// Usage:
//   formatboy_cam_registrar install [--all-users]
//   formatboy_cam_registrar remove  [--all-users] [--unregister-com]
//   formatboy_cam_registrar probe
//
// Must run elevated (Administrator) for --all-users operations.
// The NSIS installer runs this elevated automatically.
//
// PROBE exits 0 if registration is healthy, non-zero otherwise.
// Do NOT use Get-PnpDevice / WMI for health-checking — they are unreliable
// for several minutes after registration.  Use this probe exclusively.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define INITGUID   // must be defined ONCE per exe before windows.h
#include <windows.h>
#include <cfgmgr32.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfvirtualcamera.h>   // IMFVirtualCamera, MF_VIRTUALCAMERA_TYPE, etc.
#include <shlwapi.h>
#include <shlobj.h>
#include <uuids.h>             // CLSID_VideoInputDeviceCategory
#include <wrl/client.h>
#include <aclapi.h>            // SetEntriesInAcl, SetNamedSecurityInfo
#include <algorithm>
#include <cstdio>
#include <cstring>
#include <string>
#include <vector>
#include "../formatboy_ids.h"

#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfsensorgroup.lib")
#pragma comment(lib, "ole32.lib")
#pragma comment(lib, "oleaut32.lib")
#pragma comment(lib, "shlwapi.lib")
#pragma comment(lib, "strmiids.lib")
#pragma comment(lib, "Cfgmgr32.lib")

using Microsoft::WRL::ComPtr;

static const wchar_t* const kLegacyCameraFriendlyNames[] = {
    L"Morphly G1",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static bool IsWindows11OrGreater() {
    // MFCreateVirtualCamera requires Windows 11 (Build 22000+)
    OSVERSIONINFOEXW ovi = { sizeof(ovi) };
    // Use RtlGetVersion to bypass the manifest version lie
    using RtlGetVersion_t = LONG(WINAPI*)(OSVERSIONINFOW*);
    auto fn = (RtlGetVersion_t)GetProcAddress(GetModuleHandleW(L"ntdll.dll"), "RtlGetVersion");
    if (!fn) return false;
    fn(reinterpret_cast<OSVERSIONINFOW*>(&ovi));
    return ovi.dwBuildNumber >= 22000;
}

// Returns the directory containing this executable
static std::wstring ExeDir() {
    wchar_t path[MAX_PATH] = {};
    GetModuleFileNameW(nullptr, path, MAX_PATH);
    PathRemoveFileSpecW(path);
    return path;
}

static bool FileExists(const wchar_t* path) {
    return GetFileAttributesW(path) != INVALID_FILE_ATTRIBUTES;
}

static void EnsureDir(const wchar_t* dir) {
    SHCreateDirectoryExW(nullptr, dir, nullptr);
}

// Stop the Windows Camera Frame Server (and its monitor) so DLLs are released.
static void StopFrameServer() {
    const wchar_t* services[] = { L"FrameServerMonitor", L"FrameServer" };
    SC_HANDLE hSCM = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (!hSCM) return;
    for (auto* svcName : services) {
        SC_HANDLE hSvc = OpenServiceW(hSCM, svcName,
                                      SERVICE_STOP | SERVICE_QUERY_STATUS);
        if (!hSvc) continue;
        SERVICE_STATUS ss = {};
        ControlService(hSvc, SERVICE_CONTROL_STOP, &ss);
        // Wait up to 8 s for it to stop
        for (int i = 0; i < 80; ++i) {
            QueryServiceStatus(hSvc, &ss);
            if (ss.dwCurrentState == SERVICE_STOPPED) break;
            Sleep(100);
        }
        CloseServiceHandle(hSvc);
    }
    CloseServiceHandle(hSCM);
    Sleep(1000); // extra settle time
}

// Ensure FrameServer is running — IMFVirtualCamera::Start needs it.
// If it was stopped to copy the DLL, we must restart it before registering.
static void EnsureFrameServerRunning() {
    SC_HANDLE hSCM = OpenSCManagerW(nullptr, nullptr, SC_MANAGER_CONNECT);
    if (!hSCM) return;
    SC_HANDLE hSvc = OpenServiceW(hSCM, L"FrameServer",
                                  SERVICE_START | SERVICE_QUERY_STATUS);
    if (hSvc) {
        SERVICE_STATUS ss = {};
        QueryServiceStatus(hSvc, &ss);
        if (ss.dwCurrentState != SERVICE_RUNNING &&
            ss.dwCurrentState != SERVICE_START_PENDING) {
            StartServiceW(hSvc, 0, nullptr); // ignore ERROR_SERVICE_ALREADY_RUNNING
        }
        // Wait up to 8 s for it to reach RUNNING
        for (int i = 0; i < 80; ++i) {
            QueryServiceStatus(hSvc, &ss);
            if (ss.dwCurrentState == SERVICE_RUNNING) break;
            Sleep(100);
        }
        CloseServiceHandle(hSvc);
    }
    CloseServiceHandle(hSCM);
    Sleep(500); // settle
}

static bool CopyFileIfDifferent(const wchar_t* src, const wchar_t* dst) {
    if (!FileExists(src)) {
        wprintf(L"  [ERROR] Source not found: %s\n", src);
        return false;
    }
    // First attempt
    if (CopyFileW(src, dst, FALSE)) return true;

    DWORD err = GetLastError();
    if (err == ERROR_SHARING_VIOLATION) {
        // DLL locked by FrameServer/FrameServerMonitor — stop both and retry
        wprintf(L"  [INFO] DLL locked (err 32) — stopping camera services...\n");
        StopFrameServer();
        if (CopyFileW(src, dst, FALSE)) return true;
        err = GetLastError();
    }

    if (err == ERROR_SHARING_VIOLATION) {
        // Still locked — schedule replace-on-reboot and succeed
        wprintf(L"  [INFO] DLL still locked — scheduling replace on next reboot\n");
        if (MoveFileExW(src, dst, MOVEFILE_REPLACE_EXISTING | MOVEFILE_DELAY_UNTIL_REBOOT)) {
            wprintf(L"  [INFO] Reboot-replace scheduled for: %s\n", dst);
            return true; // treat as success; COM registration still proceeds
        }
    }

    wprintf(L"  [WARN] CopyFile %s -> %s failed: %lu\n", src, dst, err);
    return false;
}

// Grant read+execute to BUILTIN\Users, NT AUTHORITY\LOCAL SERVICE, and
// NT AUTHORITY\NETWORK SERVICE on a freshly deployed file.
//
// Why this matters: the Windows Camera FrameServer service runs inside
// svchost as LocalService. When CopyFile creates a new file, Windows
// inherits the parent ACL but, depending on the source file's prior ACL
// and the parent folder's inheritance rules, the resulting DLL may end
// up without a Users or LocalService ACE — silently denying FrameServer
// permission to load the DLL. The device then enumerates fine in the
// camera list but every preview hangs at "Preview is loading" because
// FrameServer cannot CoCreateInstance our IMFMediaSource.
static void GrantConsumerReadExecute(const wchar_t* path) {
    PSID usersSid = nullptr, localServiceSid = nullptr, networkServiceSid = nullptr;
    SID_IDENTIFIER_AUTHORITY sidNt = SECURITY_NT_AUTHORITY;
    if (!AllocateAndInitializeSid(&sidNt, 2,
            SECURITY_BUILTIN_DOMAIN_RID, DOMAIN_ALIAS_RID_USERS,
            0, 0, 0, 0, 0, 0, &usersSid)) {
        wprintf(L"  [WARN] AllocateAndInitializeSid(Users) failed: %lu\n", GetLastError());
        goto cleanup;
    }
    if (!AllocateAndInitializeSid(&sidNt, 1,
            SECURITY_LOCAL_SERVICE_RID, 0, 0, 0, 0, 0, 0, 0, &localServiceSid)) {
        wprintf(L"  [WARN] AllocateAndInitializeSid(LocalService) failed: %lu\n", GetLastError());
        goto cleanup;
    }
    if (!AllocateAndInitializeSid(&sidNt, 1,
            SECURITY_NETWORK_SERVICE_RID, 0, 0, 0, 0, 0, 0, 0, &networkServiceSid)) {
        wprintf(L"  [WARN] AllocateAndInitializeSid(NetworkService) failed: %lu\n", GetLastError());
        goto cleanup;
    }

    {
        EXPLICIT_ACCESSW ea[3] = {};
        for (int i = 0; i < 3; ++i) {
            ea[i].grfAccessPermissions = GENERIC_READ | GENERIC_EXECUTE;
            ea[i].grfAccessMode        = SET_ACCESS;
            ea[i].grfInheritance       = NO_INHERITANCE;
            ea[i].Trustee.TrusteeForm  = TRUSTEE_IS_SID;
            ea[i].Trustee.TrusteeType  = TRUSTEE_IS_WELL_KNOWN_GROUP;
        }
        ea[0].Trustee.ptstrName = (LPWSTR)usersSid;
        ea[1].Trustee.ptstrName = (LPWSTR)localServiceSid;
        ea[2].Trustee.ptstrName = (LPWSTR)networkServiceSid;

        // Read the existing DACL, merge our entries, write back.
        PACL existingDacl = nullptr;
        PSECURITY_DESCRIPTOR sd = nullptr;
        DWORD err = GetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION, nullptr, nullptr, &existingDacl, nullptr, &sd);
        if (err != ERROR_SUCCESS) {
            wprintf(L"  [WARN] GetNamedSecurityInfo(%s) failed: %lu\n", path, err);
            goto cleanup;
        }

        PACL newDacl = nullptr;
        err = SetEntriesInAclW(3, ea, existingDacl, &newDacl);
        if (err != ERROR_SUCCESS) {
            wprintf(L"  [WARN] SetEntriesInAcl(%s) failed: %lu\n", path, err);
            if (sd) LocalFree(sd);
            goto cleanup;
        }

        err = SetNamedSecurityInfoW((LPWSTR)path, SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION, nullptr, nullptr, newDacl, nullptr);
        if (err != ERROR_SUCCESS) {
            wprintf(L"  [WARN] SetNamedSecurityInfo(%s) failed: %lu\n", path, err);
        } else {
            wprintf(L"  [INFO] Granted Users/LocalService/NetworkService RX on %s\n", path);
        }
        if (newDacl) LocalFree(newDacl);
        if (sd) LocalFree(sd);
    }

cleanup:
    if (usersSid)          FreeSid(usersSid);
    if (localServiceSid)   FreeSid(localServiceSid);
    if (networkServiceSid) FreeSid(networkServiceSid);
}

static LSTATUS SetRegSZ(HKEY hk, const wchar_t* name, const wchar_t* val) {
    return RegSetValueExW(hk, name, 0, REG_SZ,
        (const BYTE*)val, (DWORD)((wcslen(val)+1)*sizeof(wchar_t)));
}

static bool IsClsidRegistered(REFCLSID clsid) {
    wchar_t clsidStr[64] = {};
    StringFromGUID2(clsid, clsidStr, 64);
    wchar_t key[256];
    _snwprintf_s(key, _countof(key), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s\\InprocServer32", clsidStr);
    HKEY hk = nullptr;
    bool found = (RegOpenKeyExW(HKEY_LOCAL_MACHINE, key, 0, KEY_READ, &hk) == ERROR_SUCCESS);
    if (hk) RegCloseKey(hk);
    return found;
}

static bool IsLegacyCameraFriendlyName(const std::wstring& friendlyName) {
    for (const auto* legacyFriendlyName : kLegacyCameraFriendlyNames) {
        if (friendlyName == legacyFriendlyName) {
            return true;
        }
    }
    return false;
}

static std::wstring GetStringAttribute(IMFAttributes* attrs, REFGUID key) {
    UINT32 chars = 0;
    if (!attrs || FAILED(attrs->GetStringLength(key, &chars))) {
        return L"";
    }

    std::wstring value(chars + 1, L'\0');
    if (FAILED(attrs->GetString(key, value.data(), chars + 1, &chars))) {
        return L"";
    }

    value.resize(chars);
    return value;
}

static void ReleaseActivateArray(IMFActivate** devices, UINT32 count) {
    if (!devices) return;

    for (UINT32 index = 0; index < count; ++index) {
        if (devices[index]) {
            devices[index]->Release();
        }
    }

    CoTaskMemFree(devices);
}

struct LegacyDirectShowEntry {
    std::wstring entryName;
    std::wstring clsid;
};

static std::wstring SymbolicLinkToInstanceId(const std::wstring& symbolicLink) {
    if (symbolicLink.empty()) {
        return L"";
    }

    std::wstring instanceId = symbolicLink;
    constexpr wchar_t prefix[] = L"\\\\?\\";
    if (instanceId.rfind(prefix, 0) == 0) {
        instanceId.erase(0, _countof(prefix) - 1);
    }

    const size_t interfaceGuidOffset = instanceId.find(L"#{");
    if (interfaceGuidOffset != std::wstring::npos) {
        instanceId.erase(interfaceGuidOffset);
    }

    std::replace(instanceId.begin(), instanceId.end(), L'#', L'\\');
    return instanceId;
}

static bool UninstallDeviceInstance(const std::wstring& instanceId) {
    if (instanceId.empty()) {
        return false;
    }

    DEVINST devInst = 0;
    CONFIGRET cr = CM_Locate_DevNodeW(
        &devInst,
        const_cast<DEVINSTID_W>(instanceId.c_str()),
        CM_LOCATE_DEVNODE_NORMAL);
    if (cr == CR_NO_SUCH_DEVNODE) {
        return false;
    }
    if (cr != CR_SUCCESS) {
        wprintf(L"  [WARN] Could not locate legacy device instance %s: 0x%08lX\n",
                instanceId.c_str(),
                cr);
        return false;
    }

    cr = CM_Uninstall_DevNode(devInst, 0);
    if (cr != CR_SUCCESS) {
        PNP_VETO_TYPE vetoType = PNP_VetoTypeUnknown;
        wchar_t vetoName[MAX_PATH] = {};
        cr = CM_Query_And_Remove_SubTreeW(
            devInst,
            &vetoType,
            vetoName,
            _countof(vetoName),
            0);
    }

    if (cr != CR_SUCCESS) {
        wprintf(L"  [WARN] Could not remove legacy device instance %s: 0x%08lX\n",
                instanceId.c_str(),
                cr);
        return false;
    }

    wprintf(L"  [INFO] Removed legacy device instance: %s\n", instanceId.c_str());
    return true;
}

static std::vector<std::wstring> CollectLegacyVirtualCameraDeviceInstances() {
    std::vector<std::wstring> instanceIds;

    ComPtr<IMFAttributes> enumAttrs;
    if (FAILED(MFCreateAttributes(&enumAttrs, 1))) {
        return instanceIds;
    }

    if (FAILED(enumAttrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                                  MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID))) {
        return instanceIds;
    }

    IMFActivate** devices = nullptr;
    UINT32 deviceCount = 0;
    if (FAILED(MFEnumDeviceSources(enumAttrs.Get(), &devices, &deviceCount))) {
        return instanceIds;
    }

    for (UINT32 index = 0; index < deviceCount; ++index) {
        const std::wstring friendlyName = GetStringAttribute(
            devices[index], MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME);
        if (!IsLegacyCameraFriendlyName(friendlyName)) {
            continue;
        }

        const std::wstring symbolicLink = GetStringAttribute(
            devices[index], MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK);
        const std::wstring instanceId = SymbolicLinkToInstanceId(symbolicLink);
        if (!instanceId.empty()) {
            instanceIds.push_back(instanceId);
        }
    }

    ReleaseActivateArray(devices, deviceCount);

    std::sort(instanceIds.begin(), instanceIds.end());
    instanceIds.erase(std::unique(instanceIds.begin(), instanceIds.end()), instanceIds.end());
    return instanceIds;
}

static std::vector<LegacyDirectShowEntry> CollectLegacyDirectShowRegistrations() {
    std::vector<LegacyDirectShowEntry> legacyEntries;

    wchar_t vcatStr[64] = {};
    StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);

    const std::wstring instanceRoot =
        std::wstring(L"SOFTWARE\\Classes\\CLSID\\") + vcatStr + L"\\Instance";

    HKEY hInstanceRoot = nullptr;
    if (RegOpenKeyExW(HKEY_LOCAL_MACHINE,
                      instanceRoot.c_str(),
                      0,
                      KEY_READ | KEY_WRITE,
                      &hInstanceRoot) != ERROR_SUCCESS) {
        return legacyEntries;
    }

    for (DWORD index = 0;; ++index) {
        wchar_t subKeyName[256] = {};
        DWORD subKeyLength = _countof(subKeyName);
        const LONG status = RegEnumKeyExW(hInstanceRoot,
                                          index,
                                          subKeyName,
                                          &subKeyLength,
                                          nullptr,
                                          nullptr,
                                          nullptr,
                                          nullptr);
        if (status == ERROR_NO_MORE_ITEMS) {
            break;
        }
        if (status != ERROR_SUCCESS) {
            break;
        }

        HKEY hEntry = nullptr;
        if (RegOpenKeyExW(hInstanceRoot, subKeyName, 0, KEY_READ, &hEntry) != ERROR_SUCCESS) {
            continue;
        }

        std::wstring friendlyName = subKeyName;
        wchar_t friendlyNameBuffer[256] = {};
        DWORD type = 0;
        DWORD dataSize = sizeof(friendlyNameBuffer);
        if (RegQueryValueExW(hEntry,
                             L"FriendlyName",
                             nullptr,
                             &type,
                             reinterpret_cast<BYTE*>(friendlyNameBuffer),
                             &dataSize) == ERROR_SUCCESS &&
            type == REG_SZ) {
            friendlyName = friendlyNameBuffer;
        }

        if (IsLegacyCameraFriendlyName(friendlyName)) {
            wchar_t clsidBuffer[64] = {};
            dataSize = sizeof(clsidBuffer);
            type = 0;
            std::wstring clsid;
            if (RegQueryValueExW(hEntry,
                                 L"CLSID",
                                 nullptr,
                                 &type,
                                 reinterpret_cast<BYTE*>(clsidBuffer),
                                 &dataSize) == ERROR_SUCCESS &&
                type == REG_SZ) {
                clsid = clsidBuffer;
            }
            legacyEntries.push_back({friendlyName, clsid});
        }

        RegCloseKey(hEntry);
    }

    RegCloseKey(hInstanceRoot);
    return legacyEntries;
}

static void RemoveLegacyDirectShowRegistrations() {
    wchar_t vcatStr[64] = {};
    StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);

    const std::wstring instanceRoot =
        std::wstring(L"SOFTWARE\\Classes\\CLSID\\") + vcatStr + L"\\Instance";

    const auto legacyEntries = CollectLegacyDirectShowRegistrations();
    for (const auto& entry : legacyEntries) {
        const auto& entryName = entry.entryName;
        const auto& clsid = entry.clsid;
        const std::wstring categoryKey = instanceRoot + L"\\" + entryName;
        RegDeleteTreeW(HKEY_LOCAL_MACHINE, categoryKey.c_str());

        if (!clsid.empty()) {
            const std::wstring clsidKey = std::wstring(L"SOFTWARE\\Classes\\CLSID\\") + clsid;
            RegDeleteTreeW(HKEY_LOCAL_MACHINE, clsidKey.c_str());
            wprintf(L"  [INFO] Removed legacy DirectShow CLSID: %s\n", clsid.c_str());
        }
    }
}

// ---------------------------------------------------------------------------
// RegisterMFClsid
// Writes HKLM\SOFTWARE\Classes\CLSID\{...}\InprocServer32 for the MF DLL.
// ---------------------------------------------------------------------------
static bool RegisterMFClsid(const wchar_t* dllDeployPath) {
    wchar_t clsidStr[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, clsidStr, 64);

    wchar_t key[256];
    _snwprintf_s(key, _countof(key), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);

    HKEY hk = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, key, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hk, nullptr) != ERROR_SUCCESS) {
        wprintf(L"  [ERROR] Cannot create CLSID key\n");
        return false;
    }
    SetRegSZ(hk, nullptr, kCameraFriendlyName);

    HKEY hInp = nullptr;
    RegCreateKeyExW(hk, L"InprocServer32", 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hInp, nullptr);
    if (hInp) {
        SetRegSZ(hInp, nullptr, dllDeployPath);
        SetRegSZ(hInp, L"ThreadingModel", L"Both");
        RegCloseKey(hInp);
    }
    RegCloseKey(hk);
    return true;
}

// ---------------------------------------------------------------------------
// RegisterDSClsid
// ---------------------------------------------------------------------------
static bool RegisterDSClsid(const wchar_t* dllDeployPath) {
    wchar_t clsidStr[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraDS, clsidStr, 64);

    wchar_t key[256];
    _snwprintf_s(key, _countof(key), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);

    HKEY hk = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, key, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hk, nullptr) != ERROR_SUCCESS)
        return false;

    SetRegSZ(hk, nullptr, kCameraFriendlyName);

    HKEY hInp = nullptr;
    RegCreateKeyExW(hk, L"InprocServer32", 0, nullptr,
        REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hInp, nullptr);
    if (hInp) {
        SetRegSZ(hInp, nullptr, dllDeployPath);
        SetRegSZ(hInp, L"ThreadingModel", L"Both");
        RegCloseKey(hInp);
    }

    // VideoInputDeviceCategory — so it shows up in DirectShow enumeration
    wchar_t vcatStr[64] = {};
    StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);
    wchar_t catKey[512];
    _snwprintf_s(catKey, _countof(catKey), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s\\Instance\\%s", vcatStr, clsidStr);

    HKEY hCat = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, catKey, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hCat, nullptr) == ERROR_SUCCESS) {
        SetRegSZ(hCat, L"FriendlyName", kCameraFriendlyName);
        SetRegSZ(hCat, L"CLSID", clsidStr);
        RegCloseKey(hCat);
    }

    RegCloseKey(hk);
    return true;
}

// ---------------------------------------------------------------------------
// CreateAndStartVirtualCamera  (Windows 11 only)
// ---------------------------------------------------------------------------
static bool CreateAndStartVirtualCamera() {
    // sourceId MUST be the CLSID string of our custom IMFMediaSource — nullptr = E_INVALIDARG
    wchar_t sourceId[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, sourceId, 64);

    ComPtr<IMFVirtualCamera> cam;
    HRESULT hr = MFCreateVirtualCamera(
        MFVirtualCameraType_SoftwareCameraSource,
        MFVirtualCameraLifetime_System,
        MFVirtualCameraAccess_AllUsers,
        kCameraFriendlyName,
        sourceId,   // CLSID of our IMFMediaSource
        nullptr, 0,
        &cam);

    if (FAILED(hr)) {
        wprintf(L"  [ERROR] MFCreateVirtualCamera failed: 0x%08lX\n", hr);
        return false;
    }

    hr = cam->Start(nullptr);
    if (FAILED(hr)) {
        wprintf(L"  [ERROR] IMFVirtualCamera::Start failed: 0x%08lX\n", hr);
        return false;
    }

    // System-lifetime camera persists; release our reference
    wprintf(L"  [OK] Virtual camera registered (MF, Windows 11)\n");
    return true;
}

// ---------------------------------------------------------------------------
// RemoveVirtualCamera
// ---------------------------------------------------------------------------
static void RemoveVirtualCameraByFriendlyName(const wchar_t* friendlyName) {
    wchar_t sourceId[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, sourceId, 64);
    ComPtr<IMFVirtualCamera> cam;
    if (SUCCEEDED(MFCreateVirtualCamera(
            MFVirtualCameraType_SoftwareCameraSource,
            MFVirtualCameraLifetime_System,
            MFVirtualCameraAccess_AllUsers,
            friendlyName, sourceId,
            nullptr, 0, &cam))) {
        cam->Remove();
    }
}

static void RemoveVirtualCamera() {
    const std::vector<std::wstring> legacyDeviceInstanceIds =
        CollectLegacyVirtualCameraDeviceInstances();
    const auto legacyDirectShowEntries = CollectLegacyDirectShowRegistrations();

    StopFrameServer();

    if (!legacyDeviceInstanceIds.empty()) {
        wprintf(L"  [INFO] Found %zu legacy virtual camera device instance(s)\n",
                legacyDeviceInstanceIds.size());
    }
    if (!legacyDirectShowEntries.empty()) {
        wprintf(L"  [INFO] Found %zu legacy DirectShow registration(s)\n",
                legacyDirectShowEntries.size());
    }

    RemoveVirtualCameraByFriendlyName(kCameraFriendlyName);
    for (const auto* legacyFriendlyName : kLegacyCameraFriendlyNames) {
        RemoveVirtualCameraByFriendlyName(legacyFriendlyName);
    }

    bool removedLegacyDevice = false;
    for (const auto& instanceId : legacyDeviceInstanceIds) {
        removedLegacyDevice |= UninstallDeviceInstance(instanceId);
    }
    if (removedLegacyDevice) {
        Sleep(500);
    }

    RemoveLegacyDirectShowRegistrations();
}

// ---------------------------------------------------------------------------
// install
// ---------------------------------------------------------------------------
static int CmdInstall(bool allUsers) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

    std::wstring srcDir = ExeDir();

    // Deployment directory
    std::wstring deployDir = allUsers
        ? GetDllDeployDirPath()
        : ([]() {
              wchar_t buf[MAX_PATH] = {};
              SHGetFolderPathW(nullptr, CSIDL_LOCAL_APPDATA, nullptr, 0, buf);
              return std::wstring(buf) + L"\\FormatBoyCam";
          })();

    EnsureDir(deployDir.c_str());
    wprintf(L"Deploying DLLs to: %s\n", deployDir.c_str());

    // Copy DLLs
    std::wstring mfSrc = srcDir + L"\\" + kMFDllName;
    std::wstring dsSrc = srcDir + L"\\" + kDSDllName;
    std::wstring mfDst = deployDir + L"\\" + kMFDllName;
    std::wstring dsDst = deployDir + L"\\" + kDSDllName;

    bool ok = true;
    ok &= CopyFileIfDifferent(mfSrc.c_str(), mfDst.c_str());
    ok &= CopyFileIfDifferent(dsSrc.c_str(), dsDst.c_str());
    if (!ok) { wprintf(L"[ERROR] DLL copy failed\n"); return 1; }

    // Make sure the FrameServer service (LocalService) and any consumer
    // app (running as a Standard User) can read+execute the DLLs.
    GrantConsumerReadExecute(mfDst.c_str());
    GrantConsumerReadExecute(dsDst.c_str());

    // Register COM CLSIDs
    ok &= RegisterMFClsid(mfDst.c_str());
    ok &= RegisterDSClsid(dsDst.c_str());
    if (!ok) { wprintf(L"[ERROR] CLSID registration failed\n"); return 1; }

    // Create the MF virtual camera device (Windows 11+)
    if (IsWindows11OrGreater()) {
        EnsureFrameServerRunning();
        // Recreate the system-lifetime camera so upgrades do not keep stale
        // device instances or registration metadata from prior builds.
        RemoveVirtualCamera();
        EnsureFrameServerRunning();
        Sleep(500);
        if (!CreateAndStartVirtualCamera()) {
            wprintf(L"[ERROR] Virtual camera creation failed\n");
            MFShutdown();
            CoUninitialize();
            return 1;
        }
    } else {
        wprintf(L"[INFO] Windows 10 detected — MF virtual camera skipped; DirectShow only\n");
    }

    MFShutdown();
    CoUninitialize();
    wprintf(L"[OK] Format-Boy CAM installed successfully\n");
    return 0;
}

// ---------------------------------------------------------------------------
// remove
// ---------------------------------------------------------------------------
static int CmdRemove(bool unregisterCom) {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

    if (IsWindows11OrGreater()) {
        EnsureFrameServerRunning();
    }

    RemoveVirtualCamera();

    if (unregisterCom) {
        // Remove MF CLSID
        wchar_t clsidStr[64] = {};
        StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, clsidStr, 64);
        wchar_t key[256];
        _snwprintf_s(key, _countof(key), _TRUNCATE,
            L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);
        RegDeleteTreeW(HKEY_LOCAL_MACHINE, key);

        // Remove DS CLSID
        StringFromGUID2(CLSID_FormatBoyVirtualCameraDS, clsidStr, 64);
        _snwprintf_s(key, _countof(key), _TRUNCATE,
            L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);
        RegDeleteTreeW(HKEY_LOCAL_MACHINE, key);

        // Remove VideoInputDeviceCategory entry
        wchar_t vcatStr[64] = {};
        StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);
        _snwprintf_s(key, _countof(key), _TRUNCATE,
            L"SOFTWARE\\Classes\\CLSID\\%s\\Instance\\%s", vcatStr, clsidStr);
        RegDeleteTreeW(HKEY_LOCAL_MACHINE, key);

        wprintf(L"[OK] COM CLSIDs removed\n");
    }

    MFShutdown();
    CoUninitialize();
    wprintf(L"[OK] Format-Boy CAM removed\n");
    return 0;
}

// ---------------------------------------------------------------------------
// probe
// Exits 0 if registration is healthy; non-zero otherwise.
// Do NOT use Get-PnpDevice/WMI — they are unreliable for several minutes
// after registration even when the camera is fully functional.
// ---------------------------------------------------------------------------
static int CmdProbe() {
    CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    MFStartup(MF_VERSION, MFSTARTUP_NOSOCKET);

    bool healthy = true;

    // 1. DLL files exist
    wchar_t mfPath[MAX_PATH], dsPath[MAX_PATH];
    const std::wstring deployDir = GetDllDeployDirPath();
    _snwprintf_s(mfPath, _countof(mfPath), _TRUNCATE,
        L"%s\\%s", deployDir.c_str(), kMFDllName);
    _snwprintf_s(dsPath, _countof(dsPath), _TRUNCATE,
        L"%s\\%s", deployDir.c_str(), kDSDllName);

    if (!FileExists(mfPath)) {
        wprintf(L"[PROBE FAIL] MF DLL missing: %s\n", mfPath);
        healthy = false;
    }
    if (!FileExists(dsPath)) {
        wprintf(L"[PROBE FAIL] DS DLL missing: %s\n", dsPath);
        healthy = false;
    }

    // 2. COM CLSIDs registered
    if (!IsClsidRegistered(CLSID_FormatBoyVirtualCameraMF)) {
        wprintf(L"[PROBE FAIL] MF CLSID not in registry\n");
        healthy = false;
    }
    if (!IsClsidRegistered(CLSID_FormatBoyVirtualCameraDS)) {
        wprintf(L"[PROBE FAIL] DS CLSID not in registry\n");
        healthy = false;
    }

    // 3. MFCreateVirtualCamera round-trip (Windows 11 only)
    if (IsWindows11OrGreater() && healthy) {
        wchar_t sourceId[64] = {};
        StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, sourceId, 64);
        ComPtr<IMFVirtualCamera> cam;
        HRESULT hr = MFCreateVirtualCamera(
            MFVirtualCameraType_SoftwareCameraSource,
            MFVirtualCameraLifetime_System,
            MFVirtualCameraAccess_AllUsers,
            kCameraFriendlyName, sourceId,
            nullptr, 0, &cam);
        if (FAILED(hr)) {
            wprintf(L"[PROBE FAIL] MFCreateVirtualCamera: 0x%08lX\n", hr);
            healthy = false;
        } else {
            wprintf(L"[PROBE OK] MFCreateVirtualCamera succeeded\n");
            // Don't call Start — just release; we're only probing
        }
    }

    const auto legacyDeviceInstanceIds = CollectLegacyVirtualCameraDeviceInstances();
    if (!legacyDeviceInstanceIds.empty()) {
        for (const auto& instanceId : legacyDeviceInstanceIds) {
            wprintf(L"[PROBE FAIL] Legacy virtual camera device instance still present: %s\n",
                    instanceId.c_str());
        }
        healthy = false;
    }

    const auto legacyDirectShowEntries = CollectLegacyDirectShowRegistrations();
    if (!legacyDirectShowEntries.empty()) {
        for (const auto& entry : legacyDirectShowEntries) {
            if (!entry.clsid.empty()) {
                wprintf(L"[PROBE FAIL] Legacy DirectShow registration still present: %s (%s)\n",
                        entry.entryName.c_str(),
                        entry.clsid.c_str());
            } else {
                wprintf(L"[PROBE FAIL] Legacy DirectShow registration still present: %s\n",
                        entry.entryName.c_str());
            }
        }
        healthy = false;
    }

    MFShutdown();
    CoUninitialize();

    if (healthy) {
        wprintf(L"[PROBE OK] Format-Boy CAM registration is healthy\n");
        return 0;
    }
    return 1;
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------
int wmain(int argc, wchar_t* argv[]) {
    if (argc < 2) {
        wprintf(L"Usage: formatboy_cam_registrar <install|remove|probe> [--all-users] [--unregister-com]\n");
        return 1;
    }

    bool allUsers       = false;
    bool unregisterCom  = false;
    for (int i = 2; i < argc; ++i) {
        if (wcscmp(argv[i], L"--all-users")      == 0) allUsers      = true;
        if (wcscmp(argv[i], L"--unregister-com") == 0) unregisterCom = true;
    }

    if (wcscmp(argv[1], L"install") == 0) return CmdInstall(allUsers);
    if (wcscmp(argv[1], L"remove")  == 0) return CmdRemove(unregisterCom);
    if (wcscmp(argv[1], L"probe")   == 0) return CmdProbe();

    wprintf(L"Unknown command: %s\n", argv[1]);
    return 1;
}
