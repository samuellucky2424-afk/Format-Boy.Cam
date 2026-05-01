#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "formatboy_publisher.h"
#include "../formatboy_protocol.h"
#include "../formatboy_ids.h"
#include <aclapi.h>
#include <sddl.h>
#include <atomic>
#include <cstring>
#include <algorithm>

// ---------------------------------------------------------------------------
FormatBoyPublisher::FormatBoyPublisher()  = default;
FormatBoyPublisher::~FormatBoyPublisher() { Close(); }

// ---------------------------------------------------------------------------
bool FormatBoyPublisher::EnsureBridgeDirectory() const {
    const std::wstring bridgeDir = GetFileBridgeDirPath();

    // Create directory; ignore ERROR_ALREADY_EXISTS
    if (!CreateDirectoryW(bridgeDir.c_str(), nullptr)) {
        if (GetLastError() != ERROR_ALREADY_EXISTS) return false;
    }

    // Apply permissive security descriptor so Session 0 / FrameServer can read
    PSECURITY_DESCRIPTOR pSD = nullptr;
    if (!ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kBridgeSecurityDescriptor, SDDL_REVISION_1, &pSD, nullptr)) {
        return true; // Non-fatal — directory might already be fine
    }

    BOOL  daclPresent = FALSE, daclDefaulted = FALSE;
    PACL  pDacl       = nullptr;
    if (GetSecurityDescriptorDacl(pSD, &daclPresent, &pDacl, &daclDefaulted)
        && daclPresent && pDacl) {
        SetNamedSecurityInfoW(
            const_cast<wchar_t*>(bridgeDir.c_str()),
            SE_FILE_OBJECT,
            DACL_SECURITY_INFORMATION | PROTECTED_DACL_SECURITY_INFORMATION,
            nullptr, nullptr, pDacl, nullptr);
    }
    LocalFree(pSD);
    return true;
}

// ---------------------------------------------------------------------------
bool FormatBoyPublisher::CreateFileBridge() {
    EnsureBridgeDirectory();
    const std::wstring bridgePath = GetFileBridgePath();

    // Security attributes for the file — same permissive DACL
    SECURITY_ATTRIBUTES sa   = {};
    sa.nLength               = sizeof(sa);
    PSECURITY_DESCRIPTOR pSD = nullptr;
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kBridgeSecurityDescriptor, SDDL_REVISION_1, &pSD, nullptr)) {
        sa.lpSecurityDescriptor = pSD;
    }

    m_hFile = CreateFileW(
        bridgePath.c_str(),
        GENERIC_READ | GENERIC_WRITE,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        &sa,
        CREATE_ALWAYS,
        FILE_ATTRIBUTE_NORMAL | FILE_FLAG_RANDOM_ACCESS,
        nullptr);

    if (pSD) LocalFree(pSD);

    if (m_hFile == INVALID_HANDLE_VALUE) return false;

    // Pre-size the file to sizeof(header) + payload
    LARGE_INTEGER li;
    li.QuadPart = static_cast<LONGLONG>(m_totalSize);
    if (!SetFilePointerEx(m_hFile, li, nullptr, FILE_BEGIN) || !SetEndOfFile(m_hFile)) {
        CloseHandle(m_hFile);
        m_hFile = INVALID_HANDLE_VALUE;
        return false;
    }

    // Apply permissive DACL to the file mapping
    pSD = nullptr;
    SECURITY_ATTRIBUTES saMap = {};
    saMap.nLength = sizeof(saMap);
    if (ConvertStringSecurityDescriptorToSecurityDescriptorW(
            kBridgeSecurityDescriptor, SDDL_REVISION_1, &pSD, nullptr)) {
        saMap.lpSecurityDescriptor = pSD;
    }

    m_hMapping = CreateFileMappingW(
        m_hFile, &saMap, PAGE_READWRITE,
        0, static_cast<DWORD>(m_totalSize),
        nullptr); // unnamed — keyed by the file path

    if (pSD) LocalFree(pSD);

    if (!m_hMapping) {
        CloseHandle(m_hFile);
        m_hFile = INVALID_HANDLE_VALUE;
        return false;
    }

    m_pView = static_cast<uint8_t*>(MapViewOfFile(m_hMapping, FILE_MAP_WRITE, 0, 0, 0));
    if (!m_pView) {
        CloseHandle(m_hMapping);
        CloseHandle(m_hFile);
        m_hMapping = NULL;
        m_hFile    = INVALID_HANDLE_VALUE;
        return false;
    }

    // Zero-initialise and write a valid header so the MF DLL can validate
    ZeroMemory(m_pView, m_totalSize);
    auto* hdr        = reinterpret_cast<SharedFrameHeader*>(m_pView);
    hdr->magic       = kFrameMagic;
    hdr->version     = kProtocolVersion;
    hdr->width       = m_width;
    hdr->height      = m_height;
    hdr->stride      = m_stride;
    hdr->pixelFormat = kPixelFormatBgra32;
    hdr->fpsNumerator   = m_fpsNum;
    hdr->fpsDenominator = m_fpsDen;
    hdr->payloadBytes   = static_cast<uint32_t>(m_stride * m_height);
    hdr->reserved       = 0; // even = no write in progress
    hdr->frameCounter   = 0;
    return true;
}

// ---------------------------------------------------------------------------
bool FormatBoyPublisher::Open(uint32_t width, uint32_t height,
                               uint32_t fpsNum, uint32_t fpsDen) {
    Close();
    m_width     = width;
    m_height    = height;
    m_stride    = width * 4; // BGRA32
    m_fpsNum    = fpsNum;
    m_fpsDen    = fpsDen;
    m_totalSize = sizeof(SharedFrameHeader) + static_cast<size_t>(m_stride) * m_height;
    return CreateFileBridge();
}

// ---------------------------------------------------------------------------
bool FormatBoyPublisher::WriteFrame(const uint8_t* bgraData,
                                     uint32_t       dataBytes,
                                     int64_t        timestampHundredsOfNs) {
    if (!m_pView || !bgraData) return false;

    auto*    hdr     = reinterpret_cast<SharedFrameHeader*>(m_pView);
    uint8_t* payload = m_pView + sizeof(SharedFrameHeader);

    // -----------------------------------------------------------------------
    // Seqlock write sequence — CRITICAL ORDER (from the implementation guide):
    //
    //  1. reserved += 1  (odd)   → signals "write in progress" to readers
    //  2. Release fence
    //  3. Write all metadata fields
    //  4. Copy pixel data
    //  5. frameCounter += 1      ← LAST write inside the window
    //  6. Release fence
    //  7. reserved += 1  (even)  → signals "write complete, safe to read"
    //
    // NEVER increment frameCounter after step 7; that would allow readers to
    // see a non-zero counter while the write window is still open (torn read).
    // -----------------------------------------------------------------------

    // Step 1: open write window
    hdr->reserved += 1; // now odd
    std::atomic_thread_fence(std::memory_order_release);

    // Step 3: metadata
    const uint32_t expectedBytes = m_stride * m_height;
    hdr->width              = m_width;
    hdr->height             = m_height;
    hdr->stride             = m_stride;
    hdr->fpsNumerator       = m_fpsNum;
    hdr->fpsDenominator     = m_fpsDen;
    hdr->pixelFormat        = kPixelFormatBgra32;
    hdr->payloadBytes       = expectedBytes;
    hdr->timestampHundredsOfNs = timestampHundredsOfNs;

    // Step 4: pixel data
    std::memset(payload, 0, expectedBytes);
    const size_t copyBytes = std::min<size_t>(dataBytes, expectedBytes);
    std::memcpy(payload, bgraData, copyBytes);

    // Step 5: frameCounter — LAST inside the window
    hdr->frameCounter += 1;

    // Step 6 & 7: close write window
    std::atomic_thread_fence(std::memory_order_release);
    hdr->reserved += 1; // now even — safe to read

    return true;
}

// ---------------------------------------------------------------------------
void FormatBoyPublisher::Close() {
    if (m_pView) {
        FlushViewOfFile(m_pView, 0);
        UnmapViewOfFile(m_pView);
        m_pView = nullptr;
    }
    if (m_hMapping) {
        CloseHandle(m_hMapping);
        m_hMapping = NULL;
    }
    if (m_hFile != INVALID_HANDLE_VALUE) {
        CloseHandle(m_hFile);
        m_hFile = INVALID_HANDLE_VALUE;
    }
}
