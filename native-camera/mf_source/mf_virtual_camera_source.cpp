// FormatBoy Virtual Camera — Media Foundation Source DLL
// Implements IMFMediaSource + IMFMediaStream.
//
// Key correctness requirements (from the implementation guide):
//   1. NV12 must be media type index 0 (browsers and WhatsApp require it)
//   2. Every sample must have MFSampleExtension_CleanPoint = TRUE
//   3. Sample timestamps must come from MFGetSystemTime(), not a calculated value
//   4. Do NOT query IMFCapturePhotoConfirmation — it always returns E_NOINTERFACE
//   5. File bridge lives at kFileBridgePath (accessible from Session 0)

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "mf_virtual_camera_source.h"
#include "../formatboy_protocol.h"
#include "../formatboy_ids.h"
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <mfvirtualcamera.h>
#include <ks.h>
#include <ksmedia.h>
#include <propvarutil.h>
#include <cstring>
#include <algorithm>
#include <new>

static void AppendRuntimeLog(const wchar_t* message);

static HRESULT CloneAttributes(IMFAttributes* source, IMFAttributes** ppAttributes) {
    if (!ppAttributes) return E_POINTER;
    *ppAttributes = nullptr;
    if (!source) return MF_E_NOT_INITIALIZED;

    UINT32 attributeCount = 0;
    HRESULT hr = source->GetCount(&attributeCount);
    if (FAILED(hr)) return hr;

    ComPtr<IMFAttributes> clone;
    hr = MFCreateAttributes(&clone, attributeCount);
    if (FAILED(hr)) return hr;

    hr = source->CopyAllItems(clone.Get());
    if (FAILED(hr)) return hr;

    *ppAttributes = clone.Detach();
    return S_OK;
}

static void AppendQiLog(const wchar_t* where, REFIID riid, HRESULT hr) {
    wchar_t guid[64] = {};
    StringFromGUID2(riid, guid, _countof(guid));

    wchar_t line[256] = {};
    swprintf_s(line, L"%s QI %s -> 0x%08lX\r\n", where, guid, hr);

    wchar_t runtimeLine[256] = {};
    swprintf_s(runtimeLine, L"%s QI %s -> 0x%08lX", where, guid, hr);
    AppendRuntimeLog(runtimeLine);

    const std::wstring qiLogPath = GetQiLogPath();

    HANDLE h = CreateFileW(
        qiLogPath.c_str(),
        FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (h == INVALID_HANDLE_VALUE) return;

    DWORD bytes = 0;
    WriteFile(h, line, static_cast<DWORD>(wcslen(line) * sizeof(wchar_t)), &bytes, nullptr);
    CloseHandle(h);
}

static void AppendRuntimeLog(const wchar_t* message) {
    // Log the process name + PID once per process so we can tell whether
    // it's the FrameServer service (svchost) loading us or the consumer
    // app (WhatsApp.exe / Camera.exe / Format-Boy.exe).
    static std::atomic<bool> s_processIdentified{false};
    bool expected = false;
    if (s_processIdentified.compare_exchange_strong(expected, true)) {
        wchar_t exe[MAX_PATH] = {};
        GetModuleFileNameW(nullptr, exe, MAX_PATH);
        wchar_t banner[MAX_PATH + 64] = {};
        swprintf_s(banner, L">>> Loaded into PID=%lu EXE=%s", GetCurrentProcessId(), exe);

        const std::wstring runtimeLogPath = GetRuntimeLogPath();

        HANDLE hb = CreateFileW(
            runtimeLogPath.c_str(),
            FILE_APPEND_DATA,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            nullptr, OPEN_ALWAYS, FILE_ATTRIBUTE_NORMAL, nullptr);
        if (hb != INVALID_HANDLE_VALUE) {
            SYSTEMTIME bst = {};
            GetLocalTime(&bst);
            wchar_t bline[MAX_PATH + 96] = {};
            swprintf_s(bline, L"[%02u:%02u:%02u.%03u] %s\r\n",
                       bst.wHour, bst.wMinute, bst.wSecond, bst.wMilliseconds, banner);
            DWORD wb = 0;
            WriteFile(hb, bline, static_cast<DWORD>(wcslen(bline) * sizeof(wchar_t)), &wb, nullptr);
            CloseHandle(hb);
        }
    }

    const std::wstring runtimeLogPath = GetRuntimeLogPath();

    HANDLE h = CreateFileW(
        runtimeLogPath.c_str(),
        FILE_APPEND_DATA,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr,
        OPEN_ALWAYS,
        FILE_ATTRIBUTE_NORMAL,
        nullptr);
    if (h == INVALID_HANDLE_VALUE) return;

    SYSTEMTIME st = {};
    GetLocalTime(&st);

    wchar_t line[512] = {};
    swprintf_s(
        line,
        L"[%02u:%02u:%02u.%03u] %s\r\n",
        st.wHour,
        st.wMinute,
        st.wSecond,
        st.wMilliseconds,
        message);

    DWORD bytes = 0;
    WriteFile(h, line, static_cast<DWORD>(wcslen(line) * sizeof(wchar_t)), &bytes, nullptr);
    CloseHandle(h);
}

static void AppendRuntimeGuidLog(const wchar_t* prefix, REFGUID guidA, REFGUID guidB) {
    wchar_t guid1[64] = {};
    wchar_t guid2[64] = {};
    StringFromGUID2(guidA, guid1, _countof(guid1));
    StringFromGUID2(guidB, guid2, _countof(guid2));

    wchar_t line[256] = {};
    swprintf_s(line, L"%s %s %s", prefix, guid1, guid2);
    AppendRuntimeLog(line);
}

static inline uint8_t ClampToByte(int value) {
    if (value < 0) return 0;
    if (value > 255) return 255;
    return static_cast<uint8_t>(value);
}

// ---------------------------------------------------------------------------
// FormatBoyActivate
// Implements IMFActivate (which extends IMFAttributes).
// FrameServer calls IClassFactory::CreateInstance, then QIs the result for
// IMFActivate. It then calls ActivateObject(IID_IMFMediaSource, ...) to get
// the real capture source. Without this wrapper, Start() returns E_NOINTERFACE.
// ---------------------------------------------------------------------------
class FormatBoyActivate : public IMFActivate {
    std::atomic<ULONG>       m_ref{1};
    ComPtr<IMFAttributes>    m_attrs;
    ComPtr<IMFMediaSourceEx> m_source;

public:
    FormatBoyActivate() { MFCreateAttributes(&m_attrs, 4); }

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override {
        if (!ppv) return E_POINTER;
        *ppv = nullptr;
        if (riid == IID_IUnknown         ||
            riid == __uuidof(IMFActivate) ||
            riid == __uuidof(IMFAttributes)) {
            *ppv = static_cast<IMFActivate*>(this);
            AppendQiLog(L"Activate", riid, S_OK);
            AddRef(); return S_OK;
        }
        AppendQiLog(L"Activate", riid, E_NOINTERFACE);
        return E_NOINTERFACE;
    }
    STDMETHOD_(ULONG, AddRef)()  override { return ++m_ref; }
    STDMETHOD_(ULONG, Release)() override {
        ULONG r = --m_ref; if (r == 0) delete this; return r;
    }

    // IMFActivate
    STDMETHOD(ActivateObject)(REFIID riid, void** ppv) override {
        AppendRuntimeGuidLog(L"ActivateObject called", riid, GUID_NULL);
        if (!m_source) {
            HRESULT hr = FormatBoyMFSource::CreateInstance(
                __uuidof(IMFMediaSourceEx), (void**)&m_source);
            if (FAILED(hr)) return hr;
        }
        return m_source->QueryInterface(riid, ppv);
    }
    STDMETHOD(ShutdownObject)() override {
        AppendRuntimeLog(L"Activate ShutdownObject called");
        if (m_source) { m_source->Shutdown(); m_source.Reset(); }
        return S_OK;
    }
    STDMETHOD(DetachObject)() override {
        AppendRuntimeLog(L"Activate DetachObject called");
        m_source.Reset();
        return S_OK;
    }

    // IMFAttributes — all delegated to m_attrs
    STDMETHOD(GetItem)(REFGUID k, PROPVARIANT* v) override { return m_attrs->GetItem(k,v); }
    STDMETHOD(GetItemType)(REFGUID k, MF_ATTRIBUTE_TYPE* t) override { return m_attrs->GetItemType(k,t); }
    STDMETHOD(CompareItem)(REFGUID k, REFPROPVARIANT v, BOOL* b) override { return m_attrs->CompareItem(k,v,b); }
    STDMETHOD(Compare)(IMFAttributes* p, MF_ATTRIBUTES_MATCH_TYPE t, BOOL* b) override { return m_attrs->Compare(p,t,b); }
    STDMETHOD(GetUINT32)(REFGUID k, UINT32* v) override { return m_attrs->GetUINT32(k,v); }
    STDMETHOD(GetUINT64)(REFGUID k, UINT64* v) override { return m_attrs->GetUINT64(k,v); }
    STDMETHOD(GetDouble)(REFGUID k, double* v) override { return m_attrs->GetDouble(k,v); }
    STDMETHOD(GetGUID)(REFGUID k, GUID* v) override { return m_attrs->GetGUID(k,v); }
    STDMETHOD(GetStringLength)(REFGUID k, UINT32* n) override { return m_attrs->GetStringLength(k,n); }
    STDMETHOD(GetString)(REFGUID k, LPWSTR s, UINT32 n, UINT32* l) override { return m_attrs->GetString(k,s,n,l); }
    STDMETHOD(GetAllocatedString)(REFGUID k, LPWSTR* s, UINT32* n) override { return m_attrs->GetAllocatedString(k,s,n); }
    STDMETHOD(GetBlobSize)(REFGUID k, UINT32* n) override { return m_attrs->GetBlobSize(k,n); }
    STDMETHOD(GetBlob)(REFGUID k, UINT8* b, UINT32 n, UINT32* r) override { return m_attrs->GetBlob(k,b,n,r); }
    STDMETHOD(GetAllocatedBlob)(REFGUID k, UINT8** b, UINT32* n) override { return m_attrs->GetAllocatedBlob(k,b,n); }
    STDMETHOD(GetUnknown)(REFGUID k, REFIID r, LPVOID* p) override { return m_attrs->GetUnknown(k,r,p); }
    STDMETHOD(SetItem)(REFGUID k, REFPROPVARIANT v) override { return m_attrs->SetItem(k,v); }
    STDMETHOD(DeleteItem)(REFGUID k) override { return m_attrs->DeleteItem(k); }
    STDMETHOD(DeleteAllItems)() override { return m_attrs->DeleteAllItems(); }
    STDMETHOD(SetUINT32)(REFGUID k, UINT32 v) override { return m_attrs->SetUINT32(k,v); }
    STDMETHOD(SetUINT64)(REFGUID k, UINT64 v) override { return m_attrs->SetUINT64(k,v); }
    STDMETHOD(SetDouble)(REFGUID k, double v) override { return m_attrs->SetDouble(k,v); }
    STDMETHOD(SetGUID)(REFGUID k, REFGUID v) override { return m_attrs->SetGUID(k,v); }
    STDMETHOD(SetString)(REFGUID k, LPCWSTR v) override { return m_attrs->SetString(k,v); }
    STDMETHOD(SetBlob)(REFGUID k, const UINT8* b, UINT32 n) override { return m_attrs->SetBlob(k,b,n); }
    STDMETHOD(SetUnknown)(REFGUID k, IUnknown* p) override { return m_attrs->SetUnknown(k,p); }
    STDMETHOD(LockStore)() override { return m_attrs->LockStore(); }
    STDMETHOD(UnlockStore)() override { return m_attrs->UnlockStore(); }
    STDMETHOD(GetCount)(UINT32* n) override { return m_attrs->GetCount(n); }
    STDMETHOD(GetItemByIndex)(UINT32 i, GUID* k, PROPVARIANT* v) override { return m_attrs->GetItemByIndex(i,k,v); }
    STDMETHOD(CopyAllItems)(IMFAttributes* d) override { return m_attrs->CopyAllItems(d); }
};

// ---------------------------------------------------------------------------
// Internal class factory (static singleton — no heap allocation needed)
// ---------------------------------------------------------------------------
class FormatBoyClassFactory : public IClassFactory {
public:
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override {
        if (riid == IID_IUnknown || riid == IID_IClassFactory) {
            *ppv = static_cast<IClassFactory*>(this);
            AppendQiLog(L"ClassFactory", riid, S_OK);
            return S_OK;
        }
        *ppv = nullptr;
        AppendQiLog(L"ClassFactory", riid, E_NOINTERFACE);
        return E_NOINTERFACE;
    }
    STDMETHOD_(ULONG, AddRef)()  override { return 2; } // static
    STDMETHOD_(ULONG, Release)() override { return 1; } // static

    STDMETHOD(CreateInstance)(IUnknown* pOuter, REFIID riid, void** ppv) override {
        if (pOuter) return CLASS_E_NOAGGREGATION;
        // FrameServer expects IMFActivate, not the raw IMFMediaSource.
        // Create an activator wrapper; ActivateObject() will create the source.
        auto* activate = new (std::nothrow) FormatBoyActivate();
        if (!activate) return E_OUTOFMEMORY;
        HRESULT hr = activate->QueryInterface(riid, ppv);
        activate->Release();
        return hr;
    }
    STDMETHOD(LockServer)(BOOL) override { return S_OK; }
};

static FormatBoyClassFactory g_factory;

HRESULT GetMFClassFactory(REFCLSID rclsid, REFIID riid, void** ppv) {
    if (rclsid != CLSID_FormatBoyVirtualCameraMF) return CLASS_E_CLASSNOTAVAILABLE;
    return g_factory.QueryInterface(riid, ppv);
}

// ===========================================================================
// FormatBoyMFSource
// ===========================================================================

FormatBoyMFSource::FormatBoyMFSource() {
    InitializeCriticalSection(&m_cs);
}

FormatBoyMFSource::~FormatBoyMFSource() {
    Shutdown();
    DeleteCriticalSection(&m_cs);
}

HRESULT FormatBoyMFSource::CreateInstance(REFIID riid, void** ppv) {
    *ppv = nullptr;
    AppendRuntimeLog(L"CreateInstance called");
    auto* p = new (std::nothrow) FormatBoyMFSource();
    if (!p) return E_OUTOFMEMORY;
    HRESULT hr = p->Initialize();
    if (SUCCEEDED(hr)) hr = p->QueryInterface(riid, ppv);
    p->Release();
    return hr;
}

HRESULT FormatBoyMFSource::Initialize() {
    AppendRuntimeLog(L"Initialize started");
    HRESULT hr = MFCreateEventQueue(&m_eventQueue);
    if (FAILED(hr)) return hr;

    // Create the one stream
    m_pStream = new (std::nothrow) FormatBoyMFStream(this);
    if (!m_pStream) return E_OUTOFMEMORY;
    m_pStream->AddRef(); // keep a strong reference

    hr = m_pStream->Initialize(kDefaultWidth, kDefaultHeight,
                                kDefaultFpsNum, kDefaultFpsDen);
    if (FAILED(hr)) return hr;

    // Wrap in a presentation descriptor
    ComPtr<IMFStreamDescriptor> sd;
    hr = m_pStream->GetStreamDescriptor(&sd);
    if (FAILED(hr)) return hr;

    IMFStreamDescriptor* rawSD = sd.Get();
    hr = MFCreatePresentationDescriptor(1, &rawSD, &m_pDesc);
    if (FAILED(hr)) return hr;

    hr = m_pDesc->SelectStream(0);
    if (FAILED(hr)) return hr;

    // Seed the pipeline with a black BGRA frame so Start()/RequestSample can
    // produce a valid first sample before upstream rendering is ready.
    m_cachedWidth = kDefaultWidth;
    m_cachedHeight = kDefaultHeight;
    m_cachedStride = kDefaultWidth * 4;
    m_cachedFrame.assign(static_cast<size_t>(m_cachedStride) * m_cachedHeight, 0);

    hr = InitializeAttributeStores();
    if (SUCCEEDED(hr)) {
        AppendRuntimeLog(L"Initialize completed");
        // FrameServer waits for the vcam SOURCE_INITIALIZE extended event
        // before signaling readiness to the consumer (WhatsApp / Camera /
        // Teams). Without this event the consumer probes attributes in a
        // loop and never calls Start(). Match the Microsoft Windows-Camera
        // SimpleMediaSource sample.
        if (m_eventQueue) {
            m_eventQueue->QueueEventParamVar(
                MEExtendedType,
                MF_FRAMESERVER_VCAMEVENT_EXTENDED_SOURCE_INITIALIZE,
                S_OK, nullptr);
            AppendRuntimeLog(L"Queued VCAMEVENT_EXTENDED_SOURCE_INITIALIZE");
        }
    }
    return hr;
}

HRESULT FormatBoyMFSource::InitializeAttributeStores() {
    // Source attributes — keep the set minimal. MFCreateVirtualCamera's
    // shim layer wraps our source and assigns the real PnP device-interface
    // symbolic link itself; if WE set MF_DEVSOURCE_ATTRIBUTE_*_SYMBOLIC_LINK
    // to a synthetic value, the FrameServer validator's
    // CM_Get_Device_Interface_Property(DEVPKEY_DeviceInterface_IsVirtualCamera)
    // lookup fails and the source is abandoned before Start().
    HRESULT hr = MFCreateAttributes(&m_sourceAttributes, 5);
    if (FAILED(hr)) return hr;

    hr = m_sourceAttributes->SetString(MF_DEVSOURCE_ATTRIBUTE_FRIENDLY_NAME,
                                       kCameraFriendlyName);
    if (FAILED(hr)) return hr;

    hr = m_sourceAttributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE,
                                     MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_GUID);
    if (FAILED(hr)) return hr;

    hr = m_sourceAttributes->SetGUID(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_CATEGORY,
                                     KSCATEGORY_VIDEO_CAMERA);
    if (FAILED(hr)) return hr;

    hr = m_sourceAttributes->SetUINT32(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_HW_SOURCE,
                                       FALSE);
    if (FAILED(hr)) return hr;

    hr = m_sourceAttributes->SetUINT32(MF_DEVSOURCE_ATTRIBUTE_SOURCE_TYPE_VIDCAP_MAX_BUFFERS,
                                       2);
    if (FAILED(hr)) return hr;

    hr = MFCreateAttributes(&m_streamAttributes, 6);
    if (FAILED(hr)) return hr;

    hr = m_streamAttributes->SetUINT32(MF_DEVICESTREAM_STREAM_ID, 0);
    if (FAILED(hr)) return hr;

    hr = m_streamAttributes->SetGUID(MF_DEVICESTREAM_STREAM_CATEGORY,
                                     PINNAME_VIDEO_CAPTURE);
    if (FAILED(hr)) return hr;

    hr = m_streamAttributes->SetUINT32(MF_DEVICESTREAM_FRAMESERVER_SHARED, TRUE);
    if (FAILED(hr)) return hr;

    hr = m_streamAttributes->SetUINT32(MF_DEVICESTREAM_MAX_FRAME_BUFFERS, 2);
    if (FAILED(hr)) return hr;

    hr = m_streamAttributes->SetUINT32(MF_DEVICESTREAM_ATTRIBUTE_FRAMESOURCE_TYPES,
                                       MFFrameSourceTypes_Color);
    if (FAILED(hr)) return hr;

    return m_streamAttributes->SetUnknown(MF_DEVICESTREAM_SOURCE_ATTRIBUTES,
                                          m_sourceAttributes.Get());
}

// IUnknown -------------------------------------------------------------------

STDMETHODIMP FormatBoyMFSource::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown ||
        riid == IID_IMFMediaSource ||
        riid == __uuidof(IMFMediaSourceEx) ||
        riid == __uuidof(IMFMediaEventGenerator)) {
        *ppv = static_cast<IMFMediaSourceEx*>(this);
        AppendQiLog(L"Source", riid, S_OK);
        AddRef(); return S_OK;
    }
    if (riid == __uuidof(IMFGetService)) {
        *ppv = static_cast<IMFGetService*>(this);
        AppendQiLog(L"Source", riid, S_OK);
        AddRef(); return S_OK;
    }
    if (riid == __uuidof(IKsControl)) {
        *ppv = static_cast<IKsControl*>(this);
        AppendQiLog(L"Source", riid, S_OK);
        AddRef(); return S_OK;
    }
    AppendQiLog(L"Source", riid, E_NOINTERFACE);
    return E_NOINTERFACE;
}
STDMETHODIMP_(ULONG) FormatBoyMFSource::AddRef()  { return ++m_ref; }
STDMETHODIMP_(ULONG) FormatBoyMFSource::Release() {
    ULONG r = --m_ref;
    if (r == 0) delete this;
    return r;
}

// IMFMediaEventGenerator -----------------------------------------------------

STDMETHODIMP FormatBoyMFSource::GetEvent(DWORD f, IMFMediaEvent** pp)
    { return m_eventQueue->GetEvent(f, pp); }
STDMETHODIMP FormatBoyMFSource::BeginGetEvent(IMFAsyncCallback* cb, IUnknown* s)
    { return m_eventQueue->BeginGetEvent(cb, s); }
STDMETHODIMP FormatBoyMFSource::EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** pp)
    { return m_eventQueue->EndGetEvent(r, pp); }
STDMETHODIMP FormatBoyMFSource::QueueEvent(MediaEventType t, REFGUID ext,
                                             HRESULT hr, const PROPVARIANT* pv)
    { return m_eventQueue->QueueEventParamVar(t, ext, hr, pv); }

// IMFMediaSource -------------------------------------------------------------

STDMETHODIMP FormatBoyMFSource::GetCharacteristics(DWORD* pdw) {
    AppendRuntimeLog(L"GetCharacteristics called");
    if (!pdw) return E_POINTER;
    *pdw = MFMEDIASOURCE_IS_LIVE;
    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::CreatePresentationDescriptor(IMFPresentationDescriptor** ppPD) {
    AppendRuntimeLog(L"CreatePresentationDescriptor called");
    if (!ppPD) return E_POINTER;
    EnterCriticalSection(&m_cs);
    HRESULT hr = m_pDesc ? m_pDesc->Clone(ppPD) : MF_E_NOT_INITIALIZED;
    LeaveCriticalSection(&m_cs);
    return hr;
}

STDMETHODIMP FormatBoyMFSource::Start(IMFPresentationDescriptor* /*pPD*/,
                                       const GUID* /*pFmt*/,
                                       const PROPVARIANT* pStart) {
    AppendRuntimeLog(L"Start called");
    EnterCriticalSection(&m_cs);
    if (m_shutdown) { LeaveCriticalSection(&m_cs); return MF_E_SHUTDOWN; }

    TryOpenFileBridge(); // non-fatal if bridge not ready yet

    ResetCachedFrameState();
    if (m_pStream) {
        m_pStream->ResetStreamingState();
    }

    bool wasRunning = m_running.exchange(true);
    if (!wasRunning) {
        m_thread = std::thread(&FormatBoyMFSource::DeliveryLoop, this);
    }
    LeaveCriticalSection(&m_cs);

    // MF spec: MENewStream MUST be queued before MESourceStarted so the
    // pipeline has the stream registered when it processes start. Some
    // consumers (Chromium, Teams) time out the source if the order is
    // reversed, which manifests as "timeout starting video source".
    if (m_pStream) {
        PROPVARIANT sv = {};
        sv.vt       = VT_UNKNOWN;
        sv.punkVal  = static_cast<IMFMediaStream*>(m_pStream);
        sv.punkVal->AddRef();
        m_eventQueue->QueueEventParamVar(MENewStream, GUID_NULL, S_OK, &sv);
        PropVariantClear(&sv);
    }

    PROPVARIANT startVar = {};
    if (pStart) PropVariantCopy(&startVar, pStart);
    else        PropVariantInit(&startVar);
    m_eventQueue->QueueEventParamVar(MESourceStarted, GUID_NULL, S_OK, &startVar);
    PropVariantClear(&startVar);

    if (m_pStream) {
        PROPVARIANT empty = {}; PropVariantInit(&empty);
        m_pStream->QueueEvent(MEStreamStarted, GUID_NULL, S_OK, &empty);
        PropVariantClear(&empty);
    }

    // Tell FrameServer this is a vcam-aware Start. Required by the
    // Win11 vcam shim before it forwards samples to the consumer.
    m_eventQueue->QueueEventParamVar(
        MEExtendedType,
        MF_FRAMESERVER_VCAMEVENT_EXTENDED_SOURCE_START,
        S_OK, nullptr);
    AppendRuntimeLog(L"Queued VCAMEVENT_EXTENDED_SOURCE_START");

    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::Stop() {
    AppendRuntimeLog(L"Stop called");
    m_running = false;
    if (m_thread.joinable()) m_thread.join();
    EnterCriticalSection(&m_cs);
    ResetCachedFrameState();
    LeaveCriticalSection(&m_cs);
    if (m_pStream) m_pStream->ResetStreamingState();

    m_eventQueue->QueueEventParamVar(MESourceStopped, GUID_NULL, S_OK, nullptr);
    if (m_pStream)
        m_pStream->QueueEvent(MEStreamStopped, GUID_NULL, S_OK, nullptr);
    m_eventQueue->QueueEventParamVar(
        MEExtendedType,
        MF_FRAMESERVER_VCAMEVENT_EXTENDED_SOURCE_STOP,
        S_OK, nullptr);
    AppendRuntimeLog(L"Queued VCAMEVENT_EXTENDED_SOURCE_STOP");
    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::Pause() {
    AppendRuntimeLog(L"Pause called");
    m_running = false;
    if (m_thread.joinable()) m_thread.join();
    EnterCriticalSection(&m_cs);
    ResetCachedFrameState();
    LeaveCriticalSection(&m_cs);
    if (m_pStream) m_pStream->ResetStreamingState();

    m_eventQueue->QueueEventParamVar(MESourcePaused, GUID_NULL, S_OK, nullptr);
    if (m_pStream)
        m_pStream->QueueEvent(MEStreamPaused, GUID_NULL, S_OK, nullptr);
    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::Shutdown() {
    AppendRuntimeLog(L"Shutdown called");
    EnterCriticalSection(&m_cs);
    bool already = m_shutdown;
    m_shutdown   = true;
    m_running    = false;
    LeaveCriticalSection(&m_cs);

    if (already) return S_OK;

    if (m_thread.joinable()) m_thread.join();
    ResetCachedFrameState();
    if (m_pStream) m_pStream->ResetStreamingState();

    if (m_eventQueue) {
        m_eventQueue->QueueEventParamVar(
            MEExtendedType,
            MF_FRAMESERVER_VCAMEVENT_EXTENDED_SOURCE_UNINITIALIZE,
            S_OK, nullptr);
        AppendRuntimeLog(L"Queued VCAMEVENT_EXTENDED_SOURCE_UNINITIALIZE");
        m_eventQueue->Shutdown();
    }
    if (m_pStream)    m_pStream->QueueEvent(MEStreamStopped, GUID_NULL, S_OK, nullptr);

    if (m_pView)   { UnmapViewOfFile(m_pView); m_pView = nullptr; }
    if (m_hMap)    { CloseHandle(m_hMap);  m_hMap  = NULL; }
    if (m_hFile != INVALID_HANDLE_VALUE) { CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE; }

    return S_OK;
}

// IMFGetService --------------------------------------------------------------

STDMETHODIMP FormatBoyMFSource::GetService(REFGUID guidService, REFIID riid, LPVOID* ppv) {
    AppendRuntimeGuidLog(L"GetService called", guidService, riid);
    if (ppv) *ppv = nullptr;
    // WhatsApp probes optional services with GUID_NULL as the service id
    // before Start(). Treat those as an unsupported interface request
    // rather than an unsupported service so the caller can continue.
    if (IsEqualGUID(guidService, GUID_NULL)) {
        return E_NOINTERFACE;
    }

    return MF_E_UNSUPPORTED_SERVICE;
}

// IKsControl --------------------------------------------------------------

STDMETHODIMP FormatBoyMFSource::KsProperty(void* Property, ULONG PropertyLength,
                                           LPVOID PropertyData, ULONG DataLength,
                                           ULONG* BytesReturned) {
    UNREFERENCED_PARAMETER(Property);
    UNREFERENCED_PARAMETER(PropertyLength);
    UNREFERENCED_PARAMETER(PropertyData);
    UNREFERENCED_PARAMETER(DataLength);
    if (BytesReturned) *BytesReturned = 0;
    AppendRuntimeLog(L"KsProperty called -> ERROR_SET_NOT_FOUND");
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

STDMETHODIMP FormatBoyMFSource::KsMethod(void* Method, ULONG MethodLength,
                                         LPVOID MethodData, ULONG DataLength,
                                         ULONG* BytesReturned) {
    UNREFERENCED_PARAMETER(Method);
    UNREFERENCED_PARAMETER(MethodLength);
    UNREFERENCED_PARAMETER(MethodData);
    UNREFERENCED_PARAMETER(DataLength);
    if (BytesReturned) *BytesReturned = 0;
    AppendRuntimeLog(L"KsMethod called -> ERROR_SET_NOT_FOUND");
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

STDMETHODIMP FormatBoyMFSource::KsEvent(void* Event, ULONG EventLength,
                                        LPVOID EventData, ULONG DataLength,
                                        ULONG* BytesReturned) {
    UNREFERENCED_PARAMETER(Event);
    UNREFERENCED_PARAMETER(EventLength);
    UNREFERENCED_PARAMETER(EventData);
    UNREFERENCED_PARAMETER(DataLength);
    if (BytesReturned) *BytesReturned = 0;
    AppendRuntimeLog(L"KsEvent called -> ERROR_SET_NOT_FOUND");
    return HRESULT_FROM_WIN32(ERROR_SET_NOT_FOUND);
}

// IMFMediaSourceEx -----------------------------------------------------------
// FrameServer QIs for IMFMediaSourceEx; without it Start() returns E_NOINTERFACE.

STDMETHODIMP FormatBoyMFSource::GetSourceAttributes(IMFAttributes** ppAttributes) {
    AppendRuntimeLog(L"GetSourceAttributes called");
    if (!ppAttributes) return E_POINTER;
    *ppAttributes = nullptr;
    if (!m_sourceAttributes) return MF_E_NOT_INITIALIZED;
    // Return the stored interface directly. Chromium and FrameServer compare
    // the returned IUnknown identity across calls; cloning produces a
    // different object every time and triggers continuous re-probing without
    // ever escalating to Start().
    *ppAttributes = m_sourceAttributes.Get();
    (*ppAttributes)->AddRef();
    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::GetStreamAttributes(DWORD /*dwStreamIdentifier*/,
                                                      IMFAttributes** ppAttributes) {
    AppendRuntimeLog(L"GetStreamAttributes called");
    if (!ppAttributes) return E_POINTER;
    *ppAttributes = nullptr;
    if (!m_streamAttributes) return MF_E_NOT_INITIALIZED;
    *ppAttributes = m_streamAttributes.Get();
    (*ppAttributes)->AddRef();
    return S_OK;
}

STDMETHODIMP FormatBoyMFSource::SetD3DManager(IUnknown* pManager) {
    AppendRuntimeLog(pManager ? L"SetD3DManager called (manager provided)"
                              : L"SetD3DManager called (null manager)");

    // This source is CPU-backed, but some consumers still expect the
    // IMFMediaSourceEx hook to succeed during setup. Keep a reference and
    // treat it as an optional compatibility hint instead of failing startup.
    m_d3dManager = pManager;
    return S_OK;
}

// File bridge ----------------------------------------------------------------

HRESULT FormatBoyMFSource::TryOpenFileBridge() {
    if (m_pView) return S_OK; // already open

    const std::wstring bridgePath = GetFileBridgePath();

    m_hFile = CreateFileW(
        bridgePath.c_str(),
        GENERIC_READ,
        FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING,
        FILE_ATTRIBUTE_NORMAL, nullptr);
    if (m_hFile == INVALID_HANDLE_VALUE) {
        return HRESULT_FROM_WIN32(GetLastError());
    }

    LARGE_INTEGER sz = {};
    if (!GetFileSizeEx(m_hFile, &sz) ||
        sz.QuadPart < (LONGLONG)sizeof(SharedFrameHeader)) {
        CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE;
        return E_FAIL;
    }

    m_hMap = CreateFileMappingW(m_hFile, nullptr, PAGE_READONLY, 0, 0, nullptr);
    if (!m_hMap) {
        CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE;
        return HRESULT_FROM_WIN32(GetLastError());
    }

    m_pView = static_cast<uint8_t*>(MapViewOfFile(m_hMap, FILE_MAP_READ, 0, 0, 0));
    if (!m_pView) {
        CloseHandle(m_hMap);   m_hMap  = NULL;
        CloseHandle(m_hFile);  m_hFile = INVALID_HANDLE_VALUE;
        return HRESULT_FROM_WIN32(GetLastError());
    }

    return S_OK;
}

void FormatBoyMFSource::ResetCachedFrameState() {
    m_cachedFrame.clear();
    m_cachedWidth = 0;
    m_cachedHeight = 0;
    m_cachedStride = 0;
}

// Delivery loop --------------------------------------------------------------

void FormatBoyMFSource::DeliveryLoop() {
    // Absolute frame pacing: schedule each tick from a fixed start time so we
    // do not drift across devices with different timer resolutions, and so
    // RequestSample never has to wait a full frame for the first delivery.
    const LONGLONG kFrameDurHns =
        static_cast<LONGLONG>((10'000'000ULL * kDefaultFpsDen) / kDefaultFpsNum);
    LONGLONG nextDeadlineHns = MFGetSystemTime();

    uint64_t lastCounter = 0;
    std::vector<uint8_t> scratch;
    bool loggedBridgeReady = false;
    bool loggedFirstFrame = false;
    bool loggedReplay = false;
    bool loggedFallback = false;
    bool loggedInvalidFrame = false;

    // Deliver the first (black) sample immediately on entry so the first
    // RequestSample after Start() resolves well within the 500 ms budget.
    while (m_running) {
        if (!m_pView) {
            if (SUCCEEDED(TryOpenFileBridge())) {
                if (!loggedBridgeReady) {
                    AppendRuntimeLog(L"Bridge opened");
                    loggedBridgeReady = true;
                }
            }
        }

        uint32_t w = 0, h = 0, pb = 0, stride = 0;
        bool gotFrame = false;

        if (m_pView) {
            auto* hdr = reinterpret_cast<const SharedFrameHeader*>(m_pView);
            const uint8_t* payload = m_pView + sizeof(SharedFrameHeader);

            if (hdr->magic == kFrameMagic) {
                // Seqlock read — spin until we get a consistent snapshot
                uint32_t seq1 = 0, seq2 = 0;
                uint64_t fc = 0;

                for (int attempt = 0; attempt < 64; ++attempt) {
                    seq1 = static_cast<volatile const SharedFrameHeader*>(hdr)->reserved;
                    if (seq1 & 1) { YieldProcessor(); continue; }

                    std::atomic_thread_fence(std::memory_order_acquire);

                    fc = hdr->frameCounter;
                    if (fc == lastCounter) break; // no new frame

                    w = hdr->width;
                    h = hdr->height;
                    stride = hdr->stride;
                    pb = hdr->payloadBytes;

                    const uint32_t expectedStride = w * 4;
                    const uint32_t expectedPayload = expectedStride * h;
                    const bool metadataValid =
                        hdr->version == kProtocolVersion &&
                        hdr->pixelFormat == kPixelFormatBgra32 &&
                        w == kDefaultWidth &&
                        h == kDefaultHeight &&
                        stride == expectedStride &&
                        pb == expectedPayload &&
                        pb <= 32u * 1024u * 1024u;

                    if (!metadataValid) {
                        if (!loggedInvalidFrame) {
                            AppendRuntimeLog(L"Invalid bridge frame metadata, using fallback frame");
                            loggedInvalidFrame = true;
                        }
                        break;
                    }

                    scratch.resize(pb);
                    std::memcpy(scratch.data(), payload, pb);

                    std::atomic_thread_fence(std::memory_order_acquire);
                    seq2 = static_cast<volatile const SharedFrameHeader*>(hdr)->reserved;

                    if (seq1 == seq2) { gotFrame = true; lastCounter = fc; break; }
                }
            }
        }

        if (gotFrame && !scratch.empty()) {
            m_cachedFrame = scratch;
            m_cachedWidth = w;
            m_cachedHeight = h;
            m_cachedStride = stride;

            if (!loggedFirstFrame) {
                AppendRuntimeLog(L"First bridge frame received");
                loggedFirstFrame = true;
            }
        }

        if (!m_pStream || !m_pStream->HasPendingSampleRequest()) {
            // Tail-sleep below still runs so we keep absolute pacing.
        } else {
            // Decide what BGRA payload to feed the converter:
            //   - valid cached frame matching declared size
            //   - otherwise nullptr -> DeliverSample emits NV12 black
            const bool cachedValid =
                !m_cachedFrame.empty() &&
                m_cachedWidth  == kDefaultWidth &&
                m_cachedHeight == kDefaultHeight &&
                m_cachedStride == kDefaultWidth * 4 &&
                m_cachedFrame.size() ==
                    static_cast<size_t>(m_cachedStride) * m_cachedHeight;

            const uint8_t* frameData = cachedValid ? m_cachedFrame.data() : nullptr;

            if (!gotFrame) {
                if (loggedFirstFrame) {
                    if (!loggedReplay) {
                        AppendRuntimeLog(L"Replaying cached frame for pending sample request");
                        loggedReplay = true;
                    }
                } else if (!loggedFallback) {
                    AppendRuntimeLog(L"Serving black fallback frame while pipeline warms up");
                    loggedFallback = true;
                }
            }

            const HRESULT hr = m_pStream->DeliverSample(
                frameData, kDefaultWidth, kDefaultHeight, nullptr);
            if (FAILED(hr)) {
                AppendRuntimeLog(L"DeliverSample failed");
            }
        }

        // Absolute pacing: target one frame interval per tick. Cap the wait
        // so we stay responsive to RequestSample bursts; if we have fallen
        // behind by more than 5 frames (e.g. paused renderer), resync.
        nextDeadlineHns += kFrameDurHns;
        const LONGLONG now = MFGetSystemTime();
        if (nextDeadlineHns > now) {
            LONGLONG waitHns = nextDeadlineHns - now;
            if (waitHns > kFrameDurHns) waitHns = kFrameDurHns;
            const DWORD waitMs = static_cast<DWORD>(waitHns / 10000);
            if (waitMs > 0) Sleep(waitMs);
        } else if ((now - nextDeadlineHns) > kFrameDurHns * 5) {
            nextDeadlineHns = now;
        }
    }
}

// ===========================================================================
// FormatBoyMFStream
// ===========================================================================

FormatBoyMFStream::FormatBoyMFStream(FormatBoyMFSource* pSource)
    : m_pSource(pSource)
{
    if (m_pSource) m_pSource->AddRef();
    InitializeCriticalSection(&m_cs);
}

FormatBoyMFStream::~FormatBoyMFStream() {
    ResetStreamingState();
    if (m_pSource) m_pSource->Release();
    DeleteCriticalSection(&m_cs);
}

HRESULT FormatBoyMFStream::Initialize(uint32_t w, uint32_t h,
                                       uint32_t fpsNum, uint32_t fpsDen) {
    m_width  = w;
    m_height = h;
    m_fpsNum = fpsNum;
    m_fpsDen = fpsDen;
    m_sampleDurationHns = static_cast<LONGLONG>((10'000'000ULL * fpsDen) / fpsNum);
    m_nextSampleTimeHns = 0;
    m_hasSampleClock = false;

    HRESULT hr = MFCreateEventQueue(&m_eventQueue);
    if (FAILED(hr)) return hr;

    // Expose NV12 first, then YUY2. Chromium/WhatsApp prefer NV12 when it is
    // available, but some capture stacks probe or select YUY2 during device
    // validation before Start(). If we advertise only NV12, those stacks can
    // reject the source before ever starting the stream.
    ComPtr<IMFMediaType> typeNV12;
    hr = MFCreateMediaType(&typeNV12);
    if (FAILED(hr)) return hr;

    typeNV12->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    typeNV12->SetGUID(MF_MT_SUBTYPE,    MFVideoFormat_NV12);
    MFSetAttributeSize(typeNV12.Get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(typeNV12.Get(), MF_MT_FRAME_RATE, fpsNum, fpsDen);
    MFSetAttributeRatio(typeNV12.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    typeNV12->SetUINT32(MF_MT_INTERLACE_MODE,     MFVideoInterlace_Progressive);
    typeNV12->SetUINT32(MF_MT_DEFAULT_STRIDE,      w);       // NV12 Y-plane stride
    typeNV12->SetUINT32(MF_MT_SAMPLE_SIZE,         w * h * 3 / 2);
    typeNV12->SetUINT32(MF_MT_FIXED_SIZE_SAMPLES,  TRUE);
    // Full-range (JFIF / 0..255) BT.601: Chromium-based stacks (WhatsApp,
    // Edge, Discord) interpret software camera sources as full range and
    // render studio-range Y values washed-out / white. Match the converter
    // below, which also produces full range.
    typeNV12->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_0_255);
    typeNV12->SetUINT32(MF_MT_YUV_MATRIX,          MFVideoTransferMatrix_BT601);
    typeNV12->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);

    ComPtr<IMFMediaType> typeYUY2;
    hr = MFCreateMediaType(&typeYUY2);
    if (FAILED(hr)) return hr;

    typeYUY2->SetGUID(MF_MT_MAJOR_TYPE, MFMediaType_Video);
    typeYUY2->SetGUID(MF_MT_SUBTYPE,    MFVideoFormat_YUY2);
    MFSetAttributeSize(typeYUY2.Get(), MF_MT_FRAME_SIZE, w, h);
    MFSetAttributeRatio(typeYUY2.Get(), MF_MT_FRAME_RATE, fpsNum, fpsDen);
    MFSetAttributeRatio(typeYUY2.Get(), MF_MT_PIXEL_ASPECT_RATIO, 1, 1);
    typeYUY2->SetUINT32(MF_MT_INTERLACE_MODE,     MFVideoInterlace_Progressive);
    typeYUY2->SetUINT32(MF_MT_DEFAULT_STRIDE,      w * 2);
    typeYUY2->SetUINT32(MF_MT_SAMPLE_SIZE,         w * h * 2);
    typeYUY2->SetUINT32(MF_MT_FIXED_SIZE_SAMPLES,  TRUE);
    typeYUY2->SetUINT32(MF_MT_VIDEO_NOMINAL_RANGE, MFNominalRange_0_255);
    typeYUY2->SetUINT32(MF_MT_YUV_MATRIX,          MFVideoTransferMatrix_BT601);
    typeYUY2->SetUINT32(MF_MT_ALL_SAMPLES_INDEPENDENT, TRUE);

    IMFMediaType* types[2] = { typeNV12.Get(), typeYUY2.Get() };
    hr = MFCreateStreamDescriptor(0, 2, types, &m_streamDesc);
    if (FAILED(hr)) return hr;

    ComPtr<IMFMediaTypeHandler> handler;
    hr = m_streamDesc->GetMediaTypeHandler(&handler);
    if (FAILED(hr)) return hr;
    hr = handler->SetCurrentMediaType(typeNV12.Get()); // NV12 remains default
    return hr;
}

// IUnknown -------------------------------------------------------------------

STDMETHODIMP FormatBoyMFStream::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown ||
        riid == IID_IMFMediaStream ||
        riid == __uuidof(IMFMediaEventGenerator)) {
        *ppv = static_cast<IMFMediaStream*>(this);
        AppendQiLog(L"Stream", riid, S_OK);
        AddRef(); return S_OK;
    }
    AppendQiLog(L"Stream", riid, E_NOINTERFACE);
    return E_NOINTERFACE;
}
STDMETHODIMP_(ULONG) FormatBoyMFStream::AddRef()  { return ++m_ref; }
STDMETHODIMP_(ULONG) FormatBoyMFStream::Release() {
    ULONG r = --m_ref;
    if (r == 0) delete this;
    return r;
}

// IMFMediaEventGenerator -----------------------------------------------------

STDMETHODIMP FormatBoyMFStream::GetEvent(DWORD f, IMFMediaEvent** pp)
    { return m_eventQueue->GetEvent(f, pp); }
STDMETHODIMP FormatBoyMFStream::BeginGetEvent(IMFAsyncCallback* cb, IUnknown* s)
    { return m_eventQueue->BeginGetEvent(cb, s); }
STDMETHODIMP FormatBoyMFStream::EndGetEvent(IMFAsyncResult* r, IMFMediaEvent** pp)
    { return m_eventQueue->EndGetEvent(r, pp); }
STDMETHODIMP FormatBoyMFStream::QueueEvent(MediaEventType t, REFGUID ext,
                                             HRESULT hr, const PROPVARIANT* pv)
    { return m_eventQueue->QueueEventParamVar(t, ext, hr, pv); }

// IMFMediaStream -------------------------------------------------------------

STDMETHODIMP FormatBoyMFStream::GetMediaSource(IMFMediaSource** pp) {
    if (!pp) return E_POINTER;
    *pp = m_pSource;
    if (*pp) (*pp)->AddRef();
    return S_OK;
}

STDMETHODIMP FormatBoyMFStream::GetStreamDescriptor(IMFStreamDescriptor** pp) {
    if (!pp) return E_POINTER;
    if (!m_streamDesc) return MF_E_NOT_INITIALIZED;
    *pp = m_streamDesc.Get();
    (*pp)->AddRef();
    return S_OK;
}

STDMETHODIMP FormatBoyMFStream::RequestSample(IUnknown* pToken) {
    AppendRuntimeLog(L"RequestSample called");
    EnterCriticalSection(&m_cs);
    if (pToken) pToken->AddRef();
    m_pendingTokens.push_back(pToken);
    LeaveCriticalSection(&m_cs);
    return S_OK;
}

bool FormatBoyMFStream::HasPendingSampleRequest() {
    EnterCriticalSection(&m_cs);
    const bool hasPending = !m_pendingTokens.empty();
    LeaveCriticalSection(&m_cs);
    return hasPending;
}

void FormatBoyMFStream::ResetStreamingState() {
    EnterCriticalSection(&m_cs);
    while (!m_pendingTokens.empty()) {
        IUnknown* token = m_pendingTokens.front();
        m_pendingTokens.pop_front();
        if (token) token->Release();
    }
    m_nextSampleTimeHns = 0;
    m_hasSampleClock = false;
    ZeroMemory(&m_lastLoggedSubtype, sizeof(m_lastLoggedSubtype));
    LeaveCriticalSection(&m_cs);
}

// Fill an NV12 buffer with a single solid color expressed as full-range
// BT.601 (Y, Cb, Cr). Used by both the black-frame fallback path and the
// FORMATBOY_VCAM_TEST_PATTERN diagnostic mode.
static void FillNv12Solid(uint8_t* nv12, uint32_t w, uint32_t h,
                          uint8_t y, uint8_t cb, uint8_t cr) {
    if (!nv12 || w == 0 || h == 0) return;
    const size_t yBytes  = static_cast<size_t>(w) * h;
    std::memset(nv12, y, yBytes);
    uint8_t* uvp = nv12 + yBytes;
    const size_t uvPairs = yBytes / 4; // one (Cb,Cr) pair per 2x2 block
    for (size_t i = 0; i < uvPairs; ++i) {
        uvp[i * 2]     = cb;
        uvp[i * 2 + 1] = cr;
    }
}

static void FillYuy2Solid(uint8_t* yuy2, uint32_t w, uint32_t h,
                          uint8_t y, uint8_t cb, uint8_t cr) {
    if (!yuy2 || w == 0 || h == 0 || (w & 1) != 0) return;
    const size_t rowBytes = static_cast<size_t>(w) * 2;
    for (uint32_t row = 0; row < h; ++row) {
        uint8_t* dst = yuy2 + static_cast<size_t>(row) * rowBytes;
        for (uint32_t col = 0; col < w; col += 2) {
            dst[0] = y;
            dst[1] = cb;
            dst[2] = y;
            dst[3] = cr;
            dst += 4;
        }
    }
}

static size_t GetSampleSizeForSubtype(REFGUID subtype, uint32_t w, uint32_t h) {
    if (subtype == MFVideoFormat_YUY2) {
        return static_cast<size_t>(w) * h * 2;
    }
    return static_cast<size_t>(w) * h * 3 / 2;
}

static const wchar_t* GetSubtypeName(REFGUID subtype) {
    if (subtype == MFVideoFormat_NV12) return L"NV12";
    if (subtype == MFVideoFormat_YUY2) return L"YUY2";
    return L"UNKNOWN";
}

static GUID GetCurrentOutputSubtype(IMFStreamDescriptor* streamDesc) {
    if (!streamDesc) return MFVideoFormat_NV12;

    ComPtr<IMFMediaTypeHandler> handler;
    if (FAILED(streamDesc->GetMediaTypeHandler(&handler))) {
        return MFVideoFormat_NV12;
    }

    ComPtr<IMFMediaType> currentType;
    if (FAILED(handler->GetCurrentMediaType(&currentType)) || !currentType) {
        return MFVideoFormat_NV12;
    }

    GUID subtype = GUID_NULL;
    if (FAILED(currentType->GetGUID(MF_MT_SUBTYPE, &subtype))) {
        return MFVideoFormat_NV12;
    }
    return subtype;
}

// Resolve the FORMATBOY_VCAM_TEST_PATTERN env var to an NV12 fill color.
// Returns false if no pattern is configured. Read once and cached so the
// hot path stays branch-free after first sample.
static bool GetNv12TestPattern(uint8_t& y, uint8_t& cb, uint8_t& cr) {
    static int s_cached = -1; // -1 unread, 0 none, 1+ pattern index
    static uint8_t s_y = 0, s_cb = 128, s_cr = 128;

    if (s_cached < 0) {
        wchar_t buf[32] = {};
        DWORD n = GetEnvironmentVariableW(L"FORMATBOY_VCAM_TEST_PATTERN",
                                           buf, _countof(buf));
        if (n == 0 || n >= _countof(buf)) {
            s_cached = 0;
        } else if (_wcsicmp(buf, L"green") == 0) {
            // Pure green (R=0,G=255,B=0) full-range BT.601:
            // Y = 150, Cb = 43, Cr = 21 (computed from converter constants)
            s_y = 150; s_cb = 43; s_cr = 21; s_cached = 1;
        } else if (_wcsicmp(buf, L"red") == 0) {
            // Pure red: Y=77, Cb=85, Cr=255 (clamped)
            s_y = 77; s_cb = 85; s_cr = 255; s_cached = 1;
        } else if (_wcsicmp(buf, L"blue") == 0) {
            // Pure blue: Y=29, Cb=255 (clamped), Cr=107
            s_y = 29; s_cb = 255; s_cr = 107; s_cached = 1;
        } else if (_wcsicmp(buf, L"white") == 0) {
            s_y = 235; s_cb = 128; s_cr = 128; s_cached = 1;
        } else if (_wcsicmp(buf, L"gray") == 0 || _wcsicmp(buf, L"grey") == 0) {
            s_y = 128; s_cb = 128; s_cr = 128; s_cached = 1;
        } else {
            s_cached = 0;
        }
    }

    if (s_cached <= 0) return false;
    y = s_y; cb = s_cb; cr = s_cr;
    return true;
}

// Sample delivery ------------------------------------------------------------

HRESULT FormatBoyMFStream::DeliverSample(const uint8_t* bgra,
                                          uint32_t w, uint32_t h,
                                          IUnknown* /*token*/) {
    // Width/height come from the source; reject anything off-spec.
    if (w == 0 || h == 0 || (w & 1) || (h & 1)) {
        return E_INVALIDARG;
    }
    if (w != m_width || h != m_height) {
        return E_INVALIDARG;
    }

    const GUID subtype = GetCurrentOutputSubtype(m_streamDesc.Get());
    const size_t sampleSize = GetSampleSizeForSubtype(subtype, w, h);
    if (sampleSize == 0 || sampleSize > 0xFFFFFFFFULL) {
        return E_INVALIDARG;
    }
    const DWORD outputSize = static_cast<DWORD>(sampleSize);

    if (!IsEqualGUID(subtype, m_lastLoggedSubtype)) {
        wchar_t msg[128] = {};
        swprintf_s(msg, L"DeliverSample using subtype %s", GetSubtypeName(subtype));
        AppendRuntimeLog(msg);
        m_lastLoggedSubtype = subtype;
    }

    // 16-byte aligned buffer keeps GPU consumers (VideoProcessor MFT,
    // Chromium's D3D11 path) happy when they import our sample.
    ComPtr<IMFMediaBuffer> buf;
    HRESULT hr = MFCreateAlignedMemoryBuffer(outputSize, 16, &buf);
    if (FAILED(hr)) {
        hr = MFCreateMemoryBuffer(outputSize, &buf);
    }
    if (FAILED(hr)) return hr;

    BYTE* pData = nullptr;
    DWORD maxLen = 0, curLen = 0;
    hr = buf->Lock(&pData, &maxLen, &curLen);
    if (FAILED(hr)) return hr;
    if (!pData || maxLen < outputSize) {
        buf->Unlock();
        return E_FAIL;
    }

    // Decide what to write into the output buffer:
    //   1. FORMATBOY_VCAM_TEST_PATTERN  -> solid color (diagnostic)
    //   2. Valid BGRA frame             -> CPU BGRA->NV12 / BGRA->YUY2 conversion
    //   3. Otherwise                    -> pure black fallback in the selected format
    uint8_t patY = 0, patCb = 128, patCr = 128;
    if (IsEqualGUID(subtype, MFVideoFormat_YUY2)) {
        if (GetNv12TestPattern(patY, patCb, patCr)) {
            FillYuy2Solid(pData, w, h, patY, patCb, patCr);
        } else if (bgra != nullptr) {
            FillYuy2Solid(pData, w, h, 0, 128, 128);
            BgraToYuy2(bgra, w, h, pData);
        } else {
            FillYuy2Solid(pData, w, h, 0, 128, 128);
        }
    } else {
        if (GetNv12TestPattern(patY, patCb, patCr)) {
            FillNv12Solid(pData, w, h, patY, patCb, patCr);
        } else if (bgra != nullptr) {
            FillNv12Solid(pData, w, h, 0, 128, 128);
            BgraToNv12(bgra, w, h, pData);
        } else {
            FillNv12Solid(pData, w, h, 0, 128, 128);
        }
    }

    buf->Unlock();
    hr = buf->SetCurrentLength(outputSize);
    if (FAILED(hr)) return hr;

    ComPtr<IMFSample> sample;
    hr = MFCreateSample(&sample);
    if (FAILED(hr)) return hr;

    hr = sample->AddBuffer(buf.Get());
    if (FAILED(hr)) return hr;

    // Live source: timestamp from the system clock, but force monotonicity
    // so the pipeline never sees a sample go backwards (which causes
    // Chromium / WhatsApp to drop the source mid-session).
    LONGLONG ts = MFGetSystemTime();
    if (m_hasSampleClock && ts < m_nextSampleTimeHns) {
        ts = m_nextSampleTimeHns;
    }
    sample->SetSampleTime(ts);
    sample->SetSampleDuration(m_sampleDurationHns);
    m_nextSampleTimeHns = ts + m_sampleDurationHns;
    m_hasSampleClock = true;

    // CRITICAL: Must be TRUE on every sample.
    // Without this Chromium's camera stack delivers 0 frames to getUserMedia.
    sample->SetUINT32(MFSampleExtension_CleanPoint, TRUE);

    // Attach the oldest pending request token so pipelined RequestSample calls
    // are honored in-order instead of being overwritten by later requests.
    EnterCriticalSection(&m_cs);
    IUnknown* tok = nullptr;
    if (!m_pendingTokens.empty()) {
        tok = m_pendingTokens.front();
        m_pendingTokens.pop_front();
    }
    LeaveCriticalSection(&m_cs);

    if (tok) {
        sample->SetUnknown(MFSampleExtension_Token, tok);
        tok->Release();
    }

    // Queue MEMediaSample — the pipeline pulls samples from the event queue
    PROPVARIANT pv = {};
    pv.vt      = VT_UNKNOWN;
    pv.punkVal = sample.Get();
    pv.punkVal->AddRef();
    hr = m_eventQueue->QueueEventParamVar(MEMediaSample, GUID_NULL, S_OK, &pv);
    PropVariantClear(&pv);
    if (SUCCEEDED(hr)) {
        AppendRuntimeLog(L"MEMediaSample queued");
    }
    return hr;
}

// BGRA → NV12 converter ------------------------------------------------------
//
// Input byte order: [B, G, R, A]  (browser canvas returns RGBA; Electron swaps
// R↔B before writing to the pipe, so by the time data reaches here it is BGRA)
//
// Full-range BT.601 (a.k.a. JFIF / JPEG):
//   Y  = (77*R + 150*G + 29*B + 128) >> 8
//   Cb = ((-43*R -  85*G + 128*B + 128) >> 8) + 128
//   Cr = ((128*R - 107*G -  21*B + 128) >> 8) + 128
// UV plane: interleaved Cb,Cr averaged over each 2x2 pixel block

void FormatBoyMFStream::BgraToNv12(const uint8_t* bgra,
                                    uint32_t w, uint32_t h,
                                    uint8_t* nv12) {
    if (!bgra || !nv12 || w == 0 || h == 0 || (w & 1) != 0 || (h & 1) != 0) {
        return;
    }

    uint8_t* yp  = nv12;
    uint8_t* uvp = nv12 + (size_t)w * h;
    const uint32_t bgraStride = w * 4;

    // Y plane (full-range BT.601 / JFIF)
    for (uint32_t row = 0; row < h; ++row) {
        for (uint32_t col = 0; col < w; ++col) {
            const uint8_t* px = bgra + (static_cast<size_t>(row) * bgraStride) + (col * 4);
            const int b = px[0], g = px[1], r = px[2];
            const int y = (77 * r + 150 * g + 29 * b + 128) >> 8;
            yp[row * w + col] = ClampToByte(y);
        }
    }

    // UV plane (2x2 block averages, full-range BT.601 / JFIF)
    for (uint32_t by = 0; by < h / 2; ++by) {
        for (uint32_t bx = 0; bx < w / 2; ++bx) {
            int sumU = 0, sumV = 0;
            for (uint32_t dy = 0; dy < 2; ++dy) {
                for (uint32_t dx = 0; dx < 2; ++dx) {
                    const uint32_t srcY = by * 2 + dy;
                    const uint32_t srcX = bx * 2 + dx;
                    const uint8_t* px = bgra + (static_cast<size_t>(srcY) * bgraStride) + (srcX * 4);
                    const int b = px[0], g = px[1], r = px[2];
                    sumU += ((-43*r -  85*g + 128*b + 128) >> 8) + 128;
                    sumV += ((128*r - 107*g -  21*b + 128) >> 8) + 128;
                }
            }
            uvp[(by * (w/2) + bx) * 2]     = ClampToByte(sumU / 4);
            uvp[(by * (w/2) + bx) * 2 + 1] = ClampToByte(sumV / 4);
        }
    }
}

void FormatBoyMFStream::BgraToYuy2(const uint8_t* bgra,
                                    uint32_t w, uint32_t h,
                                    uint8_t* yuy2) {
    if (!bgra || !yuy2 || w == 0 || h == 0 || (w & 1) != 0) {
        return;
    }

    const uint32_t bgraStride = w * 4;
    const uint32_t yuy2Stride = w * 2;

    for (uint32_t row = 0; row < h; ++row) {
        const uint8_t* src = bgra + static_cast<size_t>(row) * bgraStride;
        uint8_t* dst = yuy2 + static_cast<size_t>(row) * yuy2Stride;
        for (uint32_t col = 0; col < w; col += 2) {
            const uint8_t* px0 = src + col * 4;
            const uint8_t* px1 = px0 + 4;

            const int b0 = px0[0], g0 = px0[1], r0 = px0[2];
            const int b1 = px1[0], g1 = px1[1], r1 = px1[2];

            const int y0 = (77 * r0 + 150 * g0 + 29 * b0 + 128) >> 8;
            const int y1 = (77 * r1 + 150 * g1 + 29 * b1 + 128) >> 8;

            const int u0 = ((-43 * r0 - 85 * g0 + 128 * b0 + 128) >> 8) + 128;
            const int v0 = ((128 * r0 - 107 * g0 - 21 * b0 + 128) >> 8) + 128;
            const int u1 = ((-43 * r1 - 85 * g1 + 128 * b1 + 128) >> 8) + 128;
            const int v1 = ((128 * r1 - 107 * g1 - 21 * b1 + 128) >> 8) + 128;

            dst[0] = ClampToByte(y0);
            dst[1] = ClampToByte((u0 + u1) / 2);
            dst[2] = ClampToByte(y1);
            dst[3] = ClampToByte((v0 + v1) / 2);
            dst += 4;
        }
    }
}
