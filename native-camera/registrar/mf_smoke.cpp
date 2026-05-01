// formatboy_cam_mf_smoke.exe
// Enumerates Windows video capture devices through Media Foundation,
// selects the Format-Boy virtual camera, and attempts to read one sample.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mfreadwrite.h>
#include <mferror.h>
#include <wrl/client.h>
#include <cstdio>
#include <string>

#include "../formatboy_ids.h"

#pragma comment(lib, "mf.lib")
#pragma comment(lib, "mfuuid.lib")
#pragma comment(lib, "mfplat.lib")
#pragma comment(lib, "mfreadwrite.lib")
#pragma comment(lib, "ole32.lib")

using Microsoft::WRL::ComPtr;

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
    if (!devices) {
        return;
    }

    for (UINT32 index = 0; index < count; ++index) {
        if (devices[index]) {
            devices[index]->Release();
        }
    }

    CoTaskMemFree(devices);
}

static bool IsTargetCamera(const std::wstring& friendlyName,
                           const std::wstring& symbolicLink) {
    if (friendlyName == kCameraFriendlyName ||
        friendlyName.rfind(std::wstring(kCameraFriendlyName) + L" ", 0) == 0) {
        return true;
    }
    return false;
}

int wmain() {
    HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
    const bool shouldCoUninitialize = SUCCEEDED(hr);
    if (FAILED(hr) && hr != RPC_E_CHANGED_MODE) {
        wprintf(L"[ERROR] CoInitializeEx failed: 0x%08X\n", hr);
        return 1;
    }

    hr = MFStartup(MF_VERSION);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] MFStartup failed: 0x%08X\n", hr);
        if (shouldCoUninitialize) {
            CoUninitialize();
        }
        return 1;
    }

    int exitCode = 1;
    IMFActivate** devices = nullptr;
    UINT32 deviceCount = 0;

    ComPtr<IMFAttributes> enumAttrs;
    ComPtr<IMFActivate> targetDevice;
    ComPtr<IMFMediaSource> source;
    ComPtr<IMFAttributes> readerAttrs;
    ComPtr<IMFSourceReader> reader;
    ComPtr<IMFMediaType> requestedType;
        std::wstring selectedFriendlyName;

    hr = MFCreateAttributes(&enumAttrs, 1);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] MFCreateAttributes failed: 0x%08X\n", hr);
        goto Cleanup;
    }

    hr = enumAttrs->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                            MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] SetGUID failed: 0x%08X\n", hr);
        goto Cleanup;
    }

    hr = MFEnumDeviceSources(enumAttrs.Get(), &devices, &deviceCount);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] MFEnumDeviceSources failed: 0x%08X\n", hr);
        goto Cleanup;
    }

    wprintf(L"[INFO] Found %u video capture device(s)\n", deviceCount);

    for (UINT32 index = 0; index < deviceCount; ++index) {
        std::wstring friendlyName = GetStringAttribute(
            devices[index], MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME);
        std::wstring symbolicLink = GetStringAttribute(
            devices[index], MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_SYMBOLIC_LINK);

        wprintf(L"  [%u] %s\n", index, friendlyName.empty() ? L"<unnamed>" : friendlyName.c_str());

        if (!symbolicLink.empty()) {
            wprintf(L"      %s\n", symbolicLink.c_str());
        }

        if (!targetDevice && IsTargetCamera(friendlyName, symbolicLink)) {
            targetDevice = devices[index];
                selectedFriendlyName = friendlyName;
        }
    }

    if (!targetDevice) {
        wprintf(L"[ERROR] %s was not visible through MF device enumeration\n", kCameraFriendlyName);
        exitCode = 2;
        goto Cleanup;
    }

    hr = targetDevice->ActivateObject(IID_PPV_ARGS(&source));
    if (FAILED(hr)) {
        wprintf(L"[ERROR] ActivateObject(IMFMediaSource) failed: 0x%08X\n", hr);
        exitCode = 3;
        goto Cleanup;
    }

    hr = MFCreateAttributes(&readerAttrs, 1);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] MFCreateAttributes(reader) failed: 0x%08X\n", hr);
        exitCode = 4;
        goto Cleanup;
    }

    hr = MFCreateSourceReaderFromMediaSource(source.Get(), readerAttrs.Get(), &reader);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] MFCreateSourceReaderFromMediaSource failed: 0x%08X\n", hr);
        exitCode = 5;
        goto Cleanup;
    }

    for (DWORD typeIndex = 0; ; ++typeIndex) {
        ComPtr<IMFMediaType> nativeType;
        hr = reader->GetNativeMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                        typeIndex,
                                        &nativeType);
        if (hr == MF_E_NO_MORE_TYPES) {
            break;
        }
        if (FAILED(hr)) {
            wprintf(L"[ERROR] GetNativeMediaType failed: 0x%08X\n", hr);
            exitCode = 6;
            goto Cleanup;
        }

        GUID subtype = GUID_NULL;
        if (SUCCEEDED(nativeType->GetGUID(MF_MT_SUBTYPE, &subtype)) &&
            (subtype == MFVideoFormat_NV12 || subtype == MFVideoFormat_YUY2)) {
            requestedType = nativeType;
            break;
        }

        if (!requestedType) {
            requestedType = nativeType;
        }
    }

    if (!requestedType) {
        wprintf(L"[ERROR] No native video media type was available\n");
        exitCode = 7;
        goto Cleanup;
    }

    hr = reader->SetCurrentMediaType(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                     nullptr,
                                     requestedType.Get());
    if (FAILED(hr)) {
        wprintf(L"[ERROR] SetCurrentMediaType failed: 0x%08X\n", hr);
        exitCode = 8;
        goto Cleanup;
    }

    hr = reader->SetStreamSelection(MF_SOURCE_READER_FIRST_VIDEO_STREAM, TRUE);
    if (FAILED(hr)) {
        wprintf(L"[ERROR] SetStreamSelection failed: 0x%08X\n", hr);
        exitCode = 9;
        goto Cleanup;
    }

    for (int attempt = 0; attempt < 8; ++attempt) {
        DWORD streamIndex = 0;
        DWORD flags = 0;
        LONGLONG timestamp = 0;
        ComPtr<IMFSample> sample;

        hr = reader->ReadSample(MF_SOURCE_READER_FIRST_VIDEO_STREAM,
                                0,
                                &streamIndex,
                                &flags,
                                &timestamp,
                                &sample);
        if (FAILED(hr)) {
            wprintf(L"[ERROR] ReadSample failed: 0x%08X\n", hr);
            exitCode = 10;
            goto Cleanup;
        }

        if (flags & MF_SOURCE_READERF_ENDOFSTREAM) {
            wprintf(L"[ERROR] Source reader reached end-of-stream\n");
            exitCode = 11;
            goto Cleanup;
        }

        if (!sample) {
            continue;
        }

        ComPtr<IMFMediaBuffer> buffer;
        hr = sample->ConvertToContiguousBuffer(&buffer);
        if (FAILED(hr)) {
            wprintf(L"[ERROR] ConvertToContiguousBuffer failed: 0x%08X\n", hr);
            exitCode = 12;
            goto Cleanup;
        }

        BYTE* data = nullptr;
        DWORD maxLength = 0;
        DWORD currentLength = 0;
        hr = buffer->Lock(&data, &maxLength, &currentLength);
        if (FAILED(hr)) {
            wprintf(L"[ERROR] IMFMediaBuffer::Lock failed: 0x%08X\n", hr);
            exitCode = 13;
            goto Cleanup;
        }

        unsigned checksum = 0;
        DWORD inspectLength = currentLength < 64 ? currentLength : 64;
        for (DWORD byteIndex = 0; byteIndex < inspectLength; ++byteIndex) {
            checksum += data[byteIndex];
        }
        buffer->Unlock();

        const wchar_t* cameraName = selectedFriendlyName.empty()
            ? kCameraFriendlyName
            : selectedFriendlyName.c_str();
        wprintf(L"[OK] Read sample from %s\n", cameraName);
        wprintf(L"[OK] Bytes=%lu Timestamp=%lld Checksum=%u\n",
                currentLength,
                timestamp,
                checksum);
        exitCode = 0;
        goto Cleanup;
    }

    wprintf(L"[ERROR] No sample was produced after several read attempts\n");
    exitCode = 14;

Cleanup:
    if (devices) {
        ReleaseActivateArray(devices, deviceCount);
    }

    if (source) {
        source->Shutdown();
    }

    MFShutdown();
    if (shouldCoUninitialize) {
        CoUninitialize();
    }
    return exitCode;
}
