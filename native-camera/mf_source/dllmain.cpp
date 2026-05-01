// DllMain and COM exports for FormatBoyVirtualCameraMF.dll
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#define INITGUID   // must be defined ONCE per DLL before windows.h
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <shlwapi.h>
#include <olectl.h>
#include "../formatboy_ids.h"
#include "mf_virtual_camera_source.h"

// Declared in mf_virtual_camera_source.cpp
extern HRESULT GetMFClassFactory(REFCLSID, REFIID, void**);

// ---------------------------------------------------------------------------
static HMODULE g_hModule = nullptr;

BOOL APIENTRY DllMain(HMODULE hMod, DWORD reason, LPVOID) {
    if (reason == DLL_PROCESS_ATTACH) {
        g_hModule = hMod;
        DisableThreadLibraryCalls(hMod);
        // Do NOT call MFStartup here — DllMain runs under the loader lock,
        // and the host process (FrameServer) has already called MFStartup.
    }
    return TRUE;
}

// ---------------------------------------------------------------------------
// DllGetClassObject — COM entry point
// ---------------------------------------------------------------------------
STDAPI DllGetClassObject(REFCLSID rclsid, REFIID riid, LPVOID* ppv) {
    return GetMFClassFactory(rclsid, riid, ppv);
}

// ---------------------------------------------------------------------------
// DllCanUnloadNow
// ---------------------------------------------------------------------------
STDAPI DllCanUnloadNow() { return S_OK; }

// ---------------------------------------------------------------------------
// Helper: write a REG_SZ value
// ---------------------------------------------------------------------------
static LSTATUS RegSetSZ(HKEY hKey, const wchar_t* name, const wchar_t* val) {
    return RegSetValueExW(hKey, name, 0, REG_SZ,
        reinterpret_cast<const BYTE*>(val),
        static_cast<DWORD>((wcslen(val) + 1) * sizeof(wchar_t)));
}

// ---------------------------------------------------------------------------
// DllRegisterServer
// Registers the MF source CLSID in HKLM so Windows can load the DLL.
// The virtual camera device itself is registered by the registrar executable.
// ---------------------------------------------------------------------------
STDAPI DllRegisterServer() {
    // Determine the full path of this DLL
    wchar_t dllPath[MAX_PATH] = {};
    GetModuleFileNameW(g_hModule, dllPath, MAX_PATH);

    // CLSID string
    wchar_t clsidStr[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, clsidStr, 64);

    // HKLM\SOFTWARE\Classes\CLSID\{...}
    wchar_t keyPath[256] = {};
    _snwprintf_s(keyPath, _countof(keyPath), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);

    HKEY hClsid = nullptr;
    if (RegCreateKeyExW(HKEY_LOCAL_MACHINE, keyPath, 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hClsid, nullptr) != ERROR_SUCCESS)
        return SELFREG_E_CLASS;

    RegSetSZ(hClsid, nullptr, kCameraFriendlyName);

    // InprocServer32
    HKEY hInproc = nullptr;
    if (RegCreateKeyExW(hClsid, L"InprocServer32", 0, nullptr,
            REG_OPTION_NON_VOLATILE, KEY_WRITE, nullptr, &hInproc, nullptr) == ERROR_SUCCESS) {
        RegSetSZ(hInproc, nullptr, dllPath);
        RegSetSZ(hInproc, L"ThreadingModel", L"Both");
        RegCloseKey(hInproc);
    }

    RegCloseKey(hClsid);
    return S_OK;
}

// ---------------------------------------------------------------------------
// DllUnregisterServer
// ---------------------------------------------------------------------------
STDAPI DllUnregisterServer() {
    wchar_t clsidStr[64] = {};
    StringFromGUID2(CLSID_FormatBoyVirtualCameraMF, clsidStr, 64);

    wchar_t keyPath[256] = {};
    _snwprintf_s(keyPath, _countof(keyPath), _TRUNCATE,
        L"SOFTWARE\\Classes\\CLSID\\%s", clsidStr);

    RegDeleteTreeW(HKEY_LOCAL_MACHINE, keyPath);
    return S_OK;
}
