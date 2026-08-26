// Henshin CAM — DirectShow Virtual Camera Filter implementation
// Windows 10 / OBS / legacy app support.
// Output: YUY2 @ 1280×720 @ 30 fps.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "ds_virtual_camera.h"
#include "../henshin_protocol.h"
#include "../henshin_ids.h"
#include <uuids.h>     // MEDIASUBTYPE_YUY2, FORMAT_VideoInfo, etc.
#include <dvdmedia.h>  // VIDEOINFOHEADER
#include <cstring>
#include <cstdlib>
#include <algorithm>
#include <vector>
#include <new>

// ---------------------------------------------------------------------------
// Free an AM_MEDIA_TYPE and its inner structures
// ---------------------------------------------------------------------------
static void FreeMediaType(AM_MEDIA_TYPE& mt) {
    if (mt.cbFormat && mt.pbFormat) {
        CoTaskMemFree(mt.pbFormat);
        mt.pbFormat = nullptr;
        mt.cbFormat = 0;
    }
}

static void DeleteMediaType(AM_MEDIA_TYPE* pmt) {
    if (pmt) { FreeMediaType(*pmt); CoTaskMemFree(pmt); }
}

// ---------------------------------------------------------------------------
// Build the one media type we offer: YUY2 1280×720 @ 30fps
// ---------------------------------------------------------------------------
static bool BuildYuy2MediaType(AM_MEDIA_TYPE* pmt,
                                uint32_t w = kDefaultWidth,
                                uint32_t h = kDefaultHeight) {
    ZeroMemory(pmt, sizeof(AM_MEDIA_TYPE));
    pmt->majortype  = MEDIATYPE_Video;
    pmt->subtype    = MEDIASUBTYPE_YUY2;
    pmt->bFixedSizeSamples = TRUE;
    pmt->bTemporalCompression = FALSE;
    pmt->formattype = FORMAT_VideoInfo;

    auto* vi = (VIDEOINFOHEADER*)CoTaskMemAlloc(sizeof(VIDEOINFOHEADER));
    if (!vi) return false;
    ZeroMemory(vi, sizeof(VIDEOINFOHEADER));
    vi->AvgTimePerFrame        = 10000000LL / kDefaultFpsNum; // 100ns units
    vi->dwBitRate              = w * h * 16 * kDefaultFpsNum;
    vi->bmiHeader.biSize       = sizeof(BITMAPINFOHEADER);
    vi->bmiHeader.biWidth      = (LONG)w;
    vi->bmiHeader.biHeight     = (LONG)h;
    vi->bmiHeader.biPlanes     = 1;
    vi->bmiHeader.biBitCount   = 16;
    vi->bmiHeader.biCompression = MAKEFOURCC('Y','U','Y','2');
    vi->bmiHeader.biSizeImage   = w * h * 2;

    pmt->pbFormat   = (BYTE*)vi;
    pmt->cbFormat   = sizeof(VIDEOINFOHEADER);
    pmt->lSampleSize = w * h * 2;
    return true;
}

static bool IsSupportedMediaType(const AM_MEDIA_TYPE* pmt) {
    if (!pmt || pmt->majortype != MEDIATYPE_Video ||
        pmt->subtype != MEDIASUBTYPE_YUY2 ||
        pmt->formattype != FORMAT_VideoInfo ||
        !pmt->pbFormat || pmt->cbFormat < sizeof(VIDEOINFOHEADER)) {
        return false;
    }

    const auto* vi = reinterpret_cast<const VIDEOINFOHEADER*>(pmt->pbFormat);
    return vi->bmiHeader.biWidth == static_cast<LONG>(kDefaultWidth) &&
           std::abs(vi->bmiHeader.biHeight) == static_cast<LONG>(kDefaultHeight) &&
           vi->bmiHeader.biPlanes == 1 &&
           vi->bmiHeader.biBitCount == 16 &&
           vi->bmiHeader.biCompression == MAKEFOURCC('Y', 'U', 'Y', '2');
}

// ===========================================================================
// CHenshinDSFilter
// ===========================================================================

CHenshinDSFilter::CHenshinDSFilter() : m_pin(this) {
    InitializeCriticalSection(&m_cs);
}
CHenshinDSFilter::~CHenshinDSFilter() {
    DeleteCriticalSection(&m_cs);
}

HRESULT CHenshinDSFilter::CreateInstance(REFIID riid, void** ppv) {
    *ppv = nullptr;
    auto* p = new (std::nothrow) CHenshinDSFilter();
    if (!p) return E_OUTOFMEMORY;
    HRESULT hr = p->QueryInterface(riid, ppv);
    p->Release();
    return hr;
}

STDMETHODIMP CHenshinDSFilter::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown || riid == IID_IBaseFilter ||
        riid == IID_IMediaFilter || riid == IID_IPersist) {
        *ppv = static_cast<IBaseFilter*>(this);
        AddRef(); return S_OK;
    }
    if (riid == IID_IAMFilterMiscFlags) {
        *ppv = static_cast<IAMFilterMiscFlags*>(this);
        AddRef(); return S_OK;
    }
    return E_NOINTERFACE;
}
STDMETHODIMP_(ULONG) CHenshinDSFilter::AddRef()  { return ++m_ref; }
STDMETHODIMP_(ULONG) CHenshinDSFilter::Release() {
    ULONG r = --m_ref;
    if (r == 0) delete this;
    return r;
}

STDMETHODIMP CHenshinDSFilter::GetClassID(CLSID* p) {
    if (!p) return E_POINTER;
    *p = CLSID_HenshinVirtualCameraDS;
    return S_OK;
}

STDMETHODIMP CHenshinDSFilter::Stop() {
    m_pin.Inactive();
    EnterCriticalSection(&m_cs);
    m_state = State_Stopped;
    LeaveCriticalSection(&m_cs);
    return S_OK;
}

STDMETHODIMP CHenshinDSFilter::Pause() {
    EnterCriticalSection(&m_cs);
    m_state = State_Paused;
    LeaveCriticalSection(&m_cs);
    return m_pin.Active();
}

STDMETHODIMP CHenshinDSFilter::Run(REFERENCE_TIME) {
    EnterCriticalSection(&m_cs);
    m_state = State_Running;
    LeaveCriticalSection(&m_cs);
    m_pin.Active();
    return S_OK;
}

STDMETHODIMP CHenshinDSFilter::GetState(DWORD, FILTER_STATE* pState) {
    if (!pState) return E_POINTER;
    *pState = m_state;
    return S_OK;
}
STDMETHODIMP CHenshinDSFilter::SetSyncSource(IReferenceClock*) { return S_OK; }
STDMETHODIMP CHenshinDSFilter::GetSyncSource(IReferenceClock** pp) {
    if (pp) *pp = nullptr; return S_OK;
}

// ---------------------------------------------------------------------------
// Minimal IEnumPins — exposes just the one output pin
// ---------------------------------------------------------------------------
class CEnumPins : public IEnumPins {
public:
    CEnumPins(IPin* p) : m_pin(p), m_pos(0) { if (m_pin) m_pin->AddRef(); }
    ~CEnumPins() { if (m_pin) m_pin->Release(); }

    STDMETHOD(QueryInterface)(REFIID r, void** pp) override {
        if (r == IID_IUnknown || r == IID_IEnumPins) { *pp = this; AddRef(); return S_OK; }
        *pp = nullptr; return E_NOINTERFACE;
    }
    STDMETHOD_(ULONG, AddRef)()  override { return ++m_ref; }
    STDMETHOD_(ULONG, Release)() override { ULONG r=--m_ref; if(!r) delete this; return r; }
    STDMETHOD(Next)(ULONG n, IPin** pp, ULONG* pFetched) override {
        ULONG got = 0;
        while (got < n && m_pos < 1) {
            pp[got++] = m_pin; m_pin->AddRef(); ++m_pos;
        }
        if (pFetched) *pFetched = got;
        return got == n ? S_OK : S_FALSE;
    }
    STDMETHOD(Skip)(ULONG n) override { m_pos = std::min<ULONG>(m_pos+n, 1); return m_pos<1?S_OK:S_FALSE; }
    STDMETHOD(Reset)() override { m_pos = 0; return S_OK; }
    STDMETHOD(Clone)(IEnumPins** pp) override { *pp = new CEnumPins(m_pin); return S_OK; }
private:
    std::atomic<ULONG> m_ref{1};
    IPin* m_pin = nullptr;
    ULONG m_pos = 0;
};

STDMETHODIMP CHenshinDSFilter::EnumPins(IEnumPins** pp) {
    if (!pp) return E_POINTER;
    *pp = new (std::nothrow) CEnumPins(static_cast<IPin*>(&m_pin));
    return *pp ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CHenshinDSFilter::FindPin(LPCWSTR id, IPin** pp) {
    if (!pp) return E_POINTER;
    if (wcscmp(id, L"Output") == 0) {
        *pp = static_cast<IPin*>(&m_pin);
        (*pp)->AddRef();
        return S_OK;
    }
    *pp = nullptr;
    return VFW_E_NOT_FOUND;
}

STDMETHODIMP CHenshinDSFilter::QueryFilterInfo(FILTER_INFO* pfi) {
    if (!pfi) return E_POINTER;
    wcscpy_s(pfi->achName, kCameraFriendlyName);
    pfi->pGraph = m_pGraph;
    if (pfi->pGraph) pfi->pGraph->AddRef();
    return S_OK;
}

STDMETHODIMP CHenshinDSFilter::JoinFilterGraph(IFilterGraph* pGraph, LPCWSTR pName) {
    m_pGraph = pGraph;
    if (pName) wcscpy_s(m_name, pName);
    return S_OK;
}

STDMETHODIMP CHenshinDSFilter::QueryVendorInfo(LPWSTR* pp) {
    if (pp) *pp = nullptr; return E_NOTIMPL;
}

// ===========================================================================
// CHenshinOutputPin
// ===========================================================================

CHenshinOutputPin::CHenshinOutputPin(CHenshinDSFilter* f) : m_pFilter(f) {
    InitializeCriticalSection(&m_cs);
}

CHenshinOutputPin::~CHenshinOutputPin() {
    Inactive();
    CloseBridge();
    if (m_pAlloc)  { m_pAlloc->Decommit(); m_pAlloc->Release(); m_pAlloc = nullptr; }
    if (m_pMemInput){ m_pMemInput->Release();    m_pMemInput = nullptr; }
    DeleteCriticalSection(&m_cs);
}

STDMETHODIMP CHenshinOutputPin::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown || riid == IID_IPin) {
        *ppv = static_cast<IPin*>(this); AddRef(); return S_OK;
    }
    if (riid == IID_IQualityControl) {
        *ppv = static_cast<IQualityControl*>(this); AddRef(); return S_OK;
    }
    if (riid == IID_IAMStreamConfig) {
        *ppv = static_cast<IAMStreamConfig*>(this); AddRef(); return S_OK;
    }
    if (riid == IID_IKsPropertySet) {
        *ppv = static_cast<IKsPropertySet*>(this); AddRef(); return S_OK;
    }
    return E_NOINTERFACE;
}
STDMETHODIMP_(ULONG) CHenshinOutputPin::AddRef()  { return m_pFilter->AddRef(); }
STDMETHODIMP_(ULONG) CHenshinOutputPin::Release() { return m_pFilter->Release(); }

bool CHenshinOutputPin::FillMediaType(AM_MEDIA_TYPE* pmt) const {
    return BuildYuy2MediaType(pmt);
}

STDMETHODIMP CHenshinOutputPin::SetFormat(AM_MEDIA_TYPE* pmt) {
    return IsSupportedMediaType(pmt) ? S_OK : VFW_E_INVALIDMEDIATYPE;
}

STDMETHODIMP CHenshinOutputPin::GetFormat(AM_MEDIA_TYPE** ppmt) {
    if (!ppmt) return E_POINTER;
    *ppmt = static_cast<AM_MEDIA_TYPE*>(CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE)));
    if (!*ppmt) return E_OUTOFMEMORY;
    if (!FillMediaType(*ppmt)) {
        CoTaskMemFree(*ppmt);
        *ppmt = nullptr;
        return E_OUTOFMEMORY;
    }
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::GetNumberOfCapabilities(int* piCount, int* piSize) {
    if (!piCount || !piSize) return E_POINTER;
    *piCount = 1;
    *piSize = sizeof(VIDEO_STREAM_CONFIG_CAPS);
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::GetStreamCaps(int iIndex, AM_MEDIA_TYPE** ppmt, BYTE* pSCC) {
    if (!ppmt || !pSCC) return E_POINTER;
    if (iIndex != 0) return S_FALSE;

    HRESULT hr = GetFormat(ppmt);
    if (FAILED(hr)) return hr;

    auto* caps = reinterpret_cast<VIDEO_STREAM_CONFIG_CAPS*>(pSCC);
    ZeroMemory(caps, sizeof(*caps));
    caps->guid = FORMAT_VideoInfo;
    caps->InputSize.cx = kDefaultWidth;
    caps->InputSize.cy = kDefaultHeight;
    caps->MinCroppingSize = caps->InputSize;
    caps->MaxCroppingSize = caps->InputSize;
    caps->CropGranularityX = 1;
    caps->CropGranularityY = 1;
    caps->CropAlignX = 1;
    caps->CropAlignY = 1;
    caps->MinOutputSize = caps->InputSize;
    caps->MaxOutputSize = caps->InputSize;
    caps->OutputGranularityX = 1;
    caps->OutputGranularityY = 1;
    caps->MinFrameInterval = 10000000LL / kDefaultFpsNum;
    caps->MaxFrameInterval = caps->MinFrameInterval;
    caps->MinBitsPerSecond = kDefaultWidth * kDefaultHeight * 16 * kDefaultFpsNum;
    caps->MaxBitsPerSecond = caps->MinBitsPerSecond;
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::Set(REFGUID, DWORD, LPVOID, DWORD, LPVOID, DWORD) {
    return E_NOTIMPL;
}

STDMETHODIMP CHenshinOutputPin::Get(REFGUID guidPropSet, DWORD dwPropID,
                                    LPVOID, DWORD, LPVOID pPropData,
                                    DWORD cbPropData, DWORD* pcbReturned) {
    if (guidPropSet != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
    if (dwPropID != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    if (!pcbReturned) return E_POINTER;
    *pcbReturned = sizeof(GUID);
    if (!pPropData) return cbPropData == 0 ? S_OK : E_POINTER;
    if (cbPropData < sizeof(GUID)) return E_UNEXPECTED;
    *static_cast<GUID*>(pPropData) = PIN_CATEGORY_CAPTURE;
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::QuerySupported(REFGUID guidPropSet, DWORD dwPropID,
                                               DWORD* pTypeSupport) {
    if (!pTypeSupport) return E_POINTER;
    if (guidPropSet != AMPROPSETID_Pin) return E_PROP_SET_UNSUPPORTED;
    if (dwPropID != AMPROPERTY_PIN_CATEGORY) return E_PROP_ID_UNSUPPORTED;
    *pTypeSupport = KSPROPERTY_SUPPORT_GET;
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::Connect(IPin* pReceivePin, const AM_MEDIA_TYPE* pmt) {
    if (!pReceivePin) return E_POINTER;

    AM_MEDIA_TYPE mt = {};
    if (pmt) {
        if (!IsSupportedMediaType(pmt)) return VFW_E_TYPE_NOT_ACCEPTED;
        mt = *pmt;
    } else {
        if (!FillMediaType(&mt)) return E_OUTOFMEMORY;
    }

    HRESULT hr = pReceivePin->ReceiveConnection(static_cast<IPin*>(this), &mt);
    if (!pmt) FreeMediaType(mt); // we allocated it
    if (FAILED(hr)) return hr;

    m_pConnected = pReceivePin;
    m_pConnected->AddRef();

    hr = pReceivePin->QueryInterface(IID_IMemInputPin, (void**)&m_pMemInput);
    if (FAILED(hr)) { Disconnect(); return hr; }

    // Negotiate allocator
    ALLOCATOR_PROPERTIES props = {}, actual = {};
    props.cBuffers  = 4;
    props.cbBuffer  = kDefaultWidth * kDefaultHeight * 2; // YUY2
    props.cbAlign   = 1;
    props.cbPrefix  = 0;

    hr = m_pMemInput->GetAllocator(&m_pAlloc);
    if (FAILED(hr) || !m_pAlloc) {
        CoCreateInstance(CLSID_MemoryAllocator, nullptr, CLSCTX_INPROC_SERVER,
                         IID_IMemAllocator, (void**)&m_pAlloc);
    }
    if (!m_pAlloc) { Disconnect(); return E_OUTOFMEMORY; }
    hr = m_pAlloc->SetProperties(&props, &actual);
    if (FAILED(hr) || actual.cbBuffer < props.cbBuffer) {
        Disconnect();
        return HRESULT_FROM_WIN32(ERROR_INSUFFICIENT_BUFFER);
    }
    hr = m_pAlloc->Commit();
    if (FAILED(hr)) { Disconnect(); return hr; }
    hr = m_pMemInput->NotifyAllocator(m_pAlloc, FALSE);
    if (FAILED(hr)) { Disconnect(); return hr; }

    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::ReceiveConnection(IPin*, const AM_MEDIA_TYPE*) {
    return E_UNEXPECTED; // output pin doesn't receive connections
}

STDMETHODIMP CHenshinOutputPin::Disconnect() {
    Inactive();
    CloseBridge();
    if (m_pAlloc) {
        m_pAlloc->Decommit();
        m_pAlloc->Release();
        m_pAlloc = nullptr;
    }
    if (m_pMemInput) { m_pMemInput->Release(); m_pMemInput = nullptr; }
    if (m_pConnected){ m_pConnected->Release(); m_pConnected = nullptr; }
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::ConnectedTo(IPin** pp) {
    if (!pp) return E_POINTER;
    *pp = m_pConnected;
    if (*pp) (*pp)->AddRef();
    return *pp ? S_OK : VFW_E_NOT_CONNECTED;
}

STDMETHODIMP CHenshinOutputPin::ConnectionMediaType(AM_MEDIA_TYPE* pmt) {
    if (!pmt) return E_POINTER;
    if (!m_pConnected) return VFW_E_NOT_CONNECTED;
    return FillMediaType(pmt) ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CHenshinOutputPin::QueryPinInfo(PIN_INFO* pInfo) {
    if (!pInfo) return E_POINTER;
    pInfo->pFilter = static_cast<IBaseFilter*>(m_pFilter);
    if (pInfo->pFilter) pInfo->pFilter->AddRef();
    pInfo->dir = PINDIR_OUTPUT;
    wcscpy_s(pInfo->achName, L"Output");
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::QueryDirection(PIN_DIRECTION* p) {
    if (!p) return E_POINTER;
    *p = PINDIR_OUTPUT;
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::QueryId(LPWSTR* pp) {
    if (!pp) return E_POINTER;
    *pp = (LPWSTR)CoTaskMemAlloc(sizeof(L"Output"));
    if (!*pp) return E_OUTOFMEMORY;
    wcscpy(*pp, L"Output");
    return S_OK;
}

STDMETHODIMP CHenshinOutputPin::QueryAccept(const AM_MEDIA_TYPE* pmt) {
    return IsSupportedMediaType(pmt) ? S_OK : S_FALSE;
}

// Minimal IEnumMediaTypes
class CEnumMT : public IEnumMediaTypes {
public:
    CEnumMT() : m_pos(0) {}
    STDMETHOD(QueryInterface)(REFIID r,void**pp) override {
        if(r==IID_IUnknown||r==IID_IEnumMediaTypes){*pp=this;AddRef();return S_OK;}
        *pp=nullptr;return E_NOINTERFACE;
    }
    STDMETHOD_(ULONG,AddRef)()  override { return ++m_ref; }
    STDMETHOD_(ULONG,Release)() override { ULONG r=--m_ref;if(!r)delete this;return r; }
    STDMETHOD(Next)(ULONG n, AM_MEDIA_TYPE** pp, ULONG* pf) override {
        ULONG got = 0;
        while (got < n && m_pos < 1) {
            pp[got] = (AM_MEDIA_TYPE*)CoTaskMemAlloc(sizeof(AM_MEDIA_TYPE));
            if (!pp[got]) break;
            if (!BuildYuy2MediaType(pp[got])) { CoTaskMemFree(pp[got]); break; }
            ++got; ++m_pos;
        }
        if (pf) *pf = got;
        return got == n ? S_OK : S_FALSE;
    }
    STDMETHOD(Skip)(ULONG n) override { m_pos=std::min<ULONG>(m_pos+n,1);return m_pos<1?S_OK:S_FALSE; }
    STDMETHOD(Reset)() override { m_pos=0; return S_OK; }
    STDMETHOD(Clone)(IEnumMediaTypes**pp) override { *pp=new CEnumMT(); return S_OK; }
private:
    std::atomic<ULONG> m_ref{1};
    ULONG m_pos;
};

STDMETHODIMP CHenshinOutputPin::EnumMediaTypes(IEnumMediaTypes** pp) {
    if (!pp) return E_POINTER;
    *pp = new (std::nothrow) CEnumMT();
    return *pp ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CHenshinOutputPin::QueryInternalConnections(IPin**, ULONG* n) {
    if (n) *n = 0; return E_NOTIMPL;
}
STDMETHODIMP CHenshinOutputPin::EndOfStream()  { return S_OK; }
STDMETHODIMP CHenshinOutputPin::BeginFlush()   { return S_OK; }
STDMETHODIMP CHenshinOutputPin::EndFlush()     { return S_OK; }
STDMETHODIMP CHenshinOutputPin::NewSegment(REFERENCE_TIME,REFERENCE_TIME,double) {
    m_resetTimeline = true;
    return S_OK;
}

// Delivery -------------------------------------------------------------------

HRESULT CHenshinOutputPin::TryOpenBridge() {
    if (m_pView) return S_OK;
    const std::wstring bridgePath = GetFileBridgePath();
    m_hFile = CreateFileW(bridgePath.c_str(), GENERIC_READ,
        FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (m_hFile == INVALID_HANDLE_VALUE) return E_FAIL;

    LARGE_INTEGER sz = {};
    constexpr LONGLONG kExpectedBridgeSize =
        sizeof(SharedFrameHeader) +
        static_cast<LONGLONG>(kDefaultWidth) * kDefaultHeight * 4;
    if (!GetFileSizeEx(m_hFile, &sz) || sz.QuadPart < kExpectedBridgeSize) {
        CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE; return E_FAIL;
    }
    m_hMap = CreateFileMappingW(m_hFile, nullptr, PAGE_READONLY, 0, 0, nullptr);
    if (!m_hMap) { CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE; return E_FAIL; }
    m_pView = (uint8_t*)MapViewOfFile(m_hMap, FILE_MAP_READ, 0, 0, 0);
    if (!m_pView) {
        CloseHandle(m_hMap); CloseHandle(m_hFile);
        m_hMap = NULL; m_hFile = INVALID_HANDLE_VALUE; return E_FAIL;
    }
    return S_OK;
}

void CHenshinOutputPin::CloseBridge() {
    if (m_pView) {
        UnmapViewOfFile(m_pView);
        m_pView = nullptr;
    }
    if (m_hMap) {
        CloseHandle(m_hMap);
        m_hMap = NULL;
    }
    if (m_hFile != INVALID_HANDLE_VALUE) {
        CloseHandle(m_hFile);
        m_hFile = INVALID_HANDLE_VALUE;
    }
}

HRESULT CHenshinOutputPin::Active() {
    bool was = m_running.exchange(true);
    if (!was) {
        m_resetTimeline = true;
        m_thread = std::thread(&CHenshinOutputPin::DeliveryThread, this);
    }
    return S_OK;
}

HRESULT CHenshinOutputPin::Inactive() {
    m_running = false;
    if (m_thread.joinable()) m_thread.join();
    CloseBridge();
    return S_OK;
}

void CHenshinOutputPin::DeliveryThread() {
    constexpr DWORD kFrameMs = 1000 / kDefaultFpsNum;
    constexpr REFERENCE_TIME kFrameDuration = 10000000LL / kDefaultFpsNum;
    constexpr size_t kBgraSize =
        static_cast<size_t>(kDefaultWidth) * kDefaultHeight * 4;
    constexpr long kYuy2Size =
        static_cast<long>(kDefaultWidth * kDefaultHeight * 2);
    uint64_t lastCounter = 0;
    uint64_t frameIndex = 0;
    unsigned staleFrames = 0;
    std::vector<uint8_t> scratch(kBgraSize, 0);

    while (m_running) {
        if (m_resetTimeline.exchange(false)) frameIndex = 0;

        bool receivedFreshFrame = false;
        if (!m_pView) TryOpenBridge();
        if (m_pView) {
            auto* hdr = reinterpret_cast<const SharedFrameHeader*>(m_pView);
            const uint8_t* payload = m_pView + sizeof(SharedFrameHeader);

            if (hdr->magic == kFrameMagic &&
                hdr->version == kProtocolVersion &&
                hdr->width == kDefaultWidth &&
                hdr->height == kDefaultHeight &&
                hdr->stride == kDefaultWidth * 4 &&
                hdr->pixelFormat == kPixelFormatBgra32 &&
                hdr->payloadBytes == kBgraSize) {
                for (int i = 0; i < 64; ++i) {
                    const uint32_t seq1 =
                        reinterpret_cast<volatile const SharedFrameHeader*>(hdr)->reserved;
                    if (seq1 & 1) { YieldProcessor(); continue; }
                    std::atomic_thread_fence(std::memory_order_acquire);
                    const uint64_t counter = hdr->frameCounter;
                    if (counter == lastCounter) break;
                    std::memcpy(scratch.data(), payload, kBgraSize);
                    std::atomic_thread_fence(std::memory_order_acquire);
                    const uint32_t seq2 =
                        reinterpret_cast<volatile const SharedFrameHeader*>(hdr)->reserved;
                    if (seq1 == seq2) {
                        lastCounter = counter;
                        receivedFreshFrame = true;
                        break;
                    }
                }
            }
        }

        staleFrames = receivedFreshFrame ? 0 : staleFrames + 1;
        if (staleFrames >= kDefaultFpsNum * 3) {
            CloseBridge();
            staleFrames = 0;
        }

        if (!m_pMemInput || !m_pAlloc) {
            Sleep(kFrameMs);
            continue;
        }

        // Allocate downstream sample
        IMediaSample* pSample = nullptr;
        if (FAILED(m_pAlloc->GetBuffer(&pSample, nullptr, nullptr, 0))) {
            Sleep(kFrameMs);
            continue;
        }

        BYTE* pData = nullptr;
        if (pSample->GetSize() >= kYuy2Size &&
            SUCCEEDED(pSample->GetPointer(&pData))) {
            BgraToYuy2(scratch.data(), kDefaultWidth, kDefaultHeight, pData);
            pSample->SetActualDataLength(kYuy2Size);
        } else {
            pSample->Release();
            Sleep(kFrameMs);
            continue;
        }

        REFERENCE_TIME tStart = frameIndex * kFrameDuration;
        REFERENCE_TIME tStop  = tStart + kFrameDuration;
        pSample->SetTime(&tStart, &tStop);
        pSample->SetSyncPoint(TRUE);
        pSample->SetDiscontinuity(frameIndex == 0 ? TRUE : FALSE);

        m_pMemInput->Receive(pSample);
        pSample->Release();
        ++frameIndex;
        Sleep(kFrameMs);
    }
}

// BGRA → YUY2 ----------------------------------------------------------------
// YUY2 packing: [Y0, Cb, Y1, Cr] per 2-pixel horizontal pair
// Input BGRA: [B, G, R, A]

void CHenshinOutputPin::BgraToYuy2(const uint8_t* bgra, uint32_t w, uint32_t h,
                                      uint8_t* yuy2) {
    for (uint32_t row = 0; row < h; ++row) {
        for (uint32_t col = 0; col < w; col += 2) {
            const uint8_t* p0 = bgra + (row * w + col)     * 4;
            const uint8_t* p1 = bgra + (row * w + col + 1) * 4;

            const int b0=p0[0], g0=p0[1], r0=p0[2];
            const int b1=p1[0], g1=p1[1], r1=p1[2];

            const uint8_t y0 = (uint8_t)(((66*r0+129*g0+25*b0+128)>>8)+16);
            const uint8_t y1 = (uint8_t)(((66*r1+129*g1+25*b1+128)>>8)+16);
            const uint8_t cb = (uint8_t)(((-38*(r0+r1) - 74*(g0+g1) + 112*(b0+b1) + 256) >> 9) + 128);
            const uint8_t cr = (uint8_t)(((112*(r0+r1) - 94*(g0+g1) - 18*(b0+b1) + 256) >> 9) + 128);

            uint8_t* dst = yuy2 + (row * w + col) * 2;
            dst[0] = y0; dst[1] = cb; dst[2] = y1; dst[3] = cr;
        }
    }
}
