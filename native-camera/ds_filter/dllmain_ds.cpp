// DllMain and COM exports for FormatBoyVirtualCamera.dll (DirectShow)
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define INITGUID   // must be defined ONCE per DLL before windows.h
#include <windows.h>
#include <dshow.h>    // already pulls in uuids.h — do NOT include uuids.h again with INITGUID
#include <shlwapi.h>
#include <olectl.h>
#include "../formatboy_ids.h"
#include "ds_virtual_camera.h"

static HMODULE g_hModule = nullptr;

// ---------------------------------------------------------------------------
// Internal class factory
// ---------------------------------------------------------------------------
class CDSClassFactory : public IClassFactory {
public:
    STDMETHOD(QueryInterface)(REFIID r, void** pp) override {
        if (r == IID_IUnknown || r == IID_IClassFactory) { *pp=this; return S_OK; }
        *pp = nullptr; return E_NOINTERFACE;
    }
    STDMETHOD_(ULONG,AddRef)()  override { return 2; }
    STDMETHOD_(ULONG,Release)() override { return 1; }
    STDMETHOD(CreateInstance)(IUnknown* outer, REFIID riid, void** ppv) override {
        if (outer) return CLASS_E_NOAGGREGATION;
        return CFormatBoyDSFilter::CreateInstance(riid, ppv);
    }
    STDMETHOD(LockServer)(BOOL) override { return S_OK; }
};
static CDSClassFactory g_dsFactory;

// ---------------------------------------------------------------------------
BOOL APIENTRY DllMain(HMODULE hMod, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_hModule = hMod;
        DisableThreadLibraryCalls(hMod);
    }
    return TRUE;
}

STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, LPVOID* ppv) {
    if (rclsid != CLSID_FormatBoyVirtualCameraDS) return CLASS_E_CLASSNOTAVAILABLE;
    return g_dsFactory.QueryInterface(riid, ppv);
}

STDAPI DllCanUnloadNow() { return S_OK; }

// ---------------------------------------------------------------------------
static LSTATUS SetSZ(HKEY hk, const wchar_t* name, const wchar_t* val) {
    return RegSetValueExW(hk, name, 0, REG_SZ,
        (const BYTE*)val, (DWORD)((wcslen(val)+1)*sizeof(wchar_t)));
}

STDAPI DllRegisterServer() {
    wchar_t dllPath[MAX_PATH] = {};
    GetModuleFileNameW(g_hModule, dllPath, MAX_PATH);

    wchar_t clsid[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraDS, clsid, 64);

    // HKLM\SOFTWARE\Classes\CLSID\{...}\InprocServer32
    wchar_t key[256];
    _snwprintf_s(key, _countof(key), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsid);

    HKEY hk = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, key, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hk, nullptr) != ERROR_SUCCESS)
        return SELFREG_E_CLASS;

    SetSZ(hk, nullptr, kCameraFriendlyName);

    HKEY hInp = nullptr;
    if (RegCreateKeyExW(hk, L"InprocServer32", 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hInp, nullptr) == ERROR_SUCCESS) {
        SetSZ(hInp, nullptr, dllPath);
        SetSZ(hInp, L"ThreadingModel", L"Both");
        RegCloseKey(hInp);
    }

    // FriendlyName subkey
    HKEY hFN = nullptr;
    if (RegCreateKeyExW(hk, L"FriendlyName", 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hFN, nullptr) == ERROR_SUCCESS) {
        SetSZ(hFN, nullptr, kCameraFriendlyName);
        RegCloseKey(hFN);
    }
    RegCloseKey(hk);

    // Register under VideoInputDeviceCategory so it appears as a camera
    // HKLM\SOFTWARE\Classes\CLSID\{VideoInputDeviceCategory}\Instance\{OurCLSID}
    wchar_t catKey[512];
    wchar_t vcatStr[64];
    StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);
    _snwprintf_s(catKey, _countof(catKey), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s\\Instance\\%s", vcatStr, clsid);

    HKEY hCat = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, catKey, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hCat, nullptr) == ERROR_SUCCESS) {
        SetSZ(hCat, L"FriendlyName", kCameraFriendlyName);
        SetSZ(hCat, L"CLSID", clsid);
        RegCloseKey(hCat);
    }

    return S_OK;
}

STDAPI DllUnregisterServer() {
    wchar_t clsid[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraDS, clsid, 64);

    wchar_t key[256];
    _snwprintf_s(key, _countof(key), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsid);
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, key);

    wchar_t vcatStr[64];
    StringFromGUID2(CLSID_VideoInputDeviceCategory, vcatStr, 64);
    wchar_t catKey[512];
    _snwprintf_s(catKey, _countof(catKey), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s\\Instance\\%s", vcatStr, clsid);
    RegDeleteTreeW(HKEY_LOCAL_MACHINE, catKey);

    return S_OK;
}
