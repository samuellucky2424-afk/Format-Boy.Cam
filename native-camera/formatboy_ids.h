#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <knownfolders.h>
#include <shlobj.h>
#include <string>
#include <cstdint>

// ---------------------------------------------------------------------------
// GUIDs
// ---------------------------------------------------------------------------

// {4F8B2E01-3C7D-4A9F-B6E2-8D1C5A3F9B7E}  MF virtual camera source CLSID
DEFINE_GUID(CLSID_FormatBoyVirtualCameraMF,
    0x4F8B2E01, 0x3C7D, 0x4A9F,
    0xB6, 0xE2, 0x8D, 0x1C, 0x5A, 0x3F, 0x9B, 0x7E);

// {7E3A1D52-6F8B-4C2E-A5D9-3B7E1F6C8D4A}  DirectShow filter CLSID
DEFINE_GUID(CLSID_FormatBoyVirtualCameraDS,
    0x7E3A1D52, 0x6F8B, 0x4C2E,
    0xA5, 0xD9, 0x3B, 0x7E, 0x1F, 0x6C, 0x8D, 0x4A);

// ---------------------------------------------------------------------------
// Camera identity strings
// ---------------------------------------------------------------------------
static const wchar_t kCameraFriendlyName[] = L"Format-Boy CAM";
static const wchar_t kMFDllName[]          = L"FormatBoyVirtualCameraMF.dll";
static const wchar_t kDSDllName[]          = L"FormatBoyVirtualCamera.dll";
static const wchar_t kPublisherExeName[]   = L"formatboy_cam_pipe_publisher.exe";
static const wchar_t kRegistrarExeName[]   = L"formatboy_cam_registrar.exe";

// ---------------------------------------------------------------------------
// File bridge — MUST be accessible from Session 0 (FrameServer).
// Do NOT use %LOCALAPPDATA% or per-user paths.
// ---------------------------------------------------------------------------
inline std::wstring FormatBoyJoinPath(const std::wstring& base, const wchar_t* leaf) {
    if (base.empty()) return std::wstring(leaf);
    if (base.back() == L'\\') return base + leaf;
    return base + L"\\" + leaf;
}

inline std::wstring GetKnownFolderOrFallback(REFKNOWNFOLDERID folderId, const wchar_t* fallback) {
    PWSTR path = nullptr;
    if (SUCCEEDED(SHGetKnownFolderPath(folderId, KF_FLAG_DEFAULT, nullptr, &path)) && path) {
        std::wstring result(path);
        CoTaskMemFree(path);
        return result;
    }
    return std::wstring(fallback);
}

inline std::wstring GetFileBridgeDirPath() {
    return FormatBoyJoinPath(
        GetKnownFolderOrFallback(FOLDERID_PublicDocuments, L"C:\\Users\\Public\\Documents"),
        L"FormatBoyCam");
}

inline std::wstring GetFileBridgePath() {
    return FormatBoyJoinPath(GetFileBridgeDirPath(), L"mf-bridge.bin");
}

// ---------------------------------------------------------------------------
// DLL deployment path — accessible from Session 0 / FrameServer.
// ---------------------------------------------------------------------------
inline std::wstring GetDllDeployDirPath() {
    return FormatBoyJoinPath(
        GetKnownFolderOrFallback(FOLDERID_ProgramData, L"C:\\ProgramData"),
        L"FormatBoyCam");
}

inline std::wstring GetRuntimeLogPath() {
    return FormatBoyJoinPath(GetDllDeployDirPath(), L"mf_runtime.log");
}

inline std::wstring GetQiLogPath() {
    return FormatBoyJoinPath(GetDllDeployDirPath(), L"mf_qi.log");
}

// ---------------------------------------------------------------------------
// Named shared memory (fallback if file bridge fails)
// ---------------------------------------------------------------------------
static const wchar_t kGlobalSharedMemName[] = L"Global\\FormatBoyCam.FrameBuffer";
static const wchar_t kLocalSharedMemName[]  = L"Local\\FormatBoyCam.FrameBuffer";

// ---------------------------------------------------------------------------
// Security descriptor — grants full access to:
//   SY = SYSTEM, BA = Built-in Administrators,
//   LS = Local Service (FrameServer), AU = Authenticated Users
// ---------------------------------------------------------------------------
static const wchar_t kBridgeSecurityDescriptor[] =
    L"D:P(A;;GA;;;SY)(A;;GA;;;BA)(A;;GA;;;LS)(A;;GA;;;AU)";

// ---------------------------------------------------------------------------
// Default stream parameters
// ---------------------------------------------------------------------------
static constexpr uint32_t kDefaultWidth   = 1280;
static constexpr uint32_t kDefaultHeight  = 720;
static constexpr uint32_t kDefaultFpsNum  = 30;
static constexpr uint32_t kDefaultFpsDen  = 1;
