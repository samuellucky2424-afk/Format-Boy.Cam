// Format-Boy CAM — DirectShow Virtual Camera Filter implementation
// Windows 10 / OBS / legacy app support.
// Output: YUY2 @ 1280×720 @ 30 fps.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include "ds_virtual_camera.h"
#include "../formatboy_protocol.h"
#include "../formatboy_ids.h"
#include <uuids.h>     // MEDIASUBTYPE_YUY2, FORMAT_VideoInfo, etc.
#include <dvdmedia.h>  // VIDEOINFOHEADER
#include <cstring>
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
    vi->bmiHeader.biSize       = sizeof(BITMAPINFOHEADER);
    vi->bmiHeader.biWidth      = (LONG)w;
    vi->bmiHeader.biHeight     = -(LONG)h; // top-down
    vi->bmiHeader.biPlanes     = 1;
    vi->bmiHeader.biBitCount   = 16;
    vi->bmiHeader.biCompression = MAKEFOURCC('Y','U','Y','2');
    vi->bmiHeader.biSizeImage   = w * h * 2;

    pmt->pbFormat   = (BYTE*)vi;
    pmt->cbFormat   = sizeof(VIDEOINFOHEADER);
    pmt->lSampleSize = w * h * 2;
    return true;
}

// ===========================================================================
// CFormatBoyDSFilter
// ===========================================================================

CFormatBoyDSFilter::CFormatBoyDSFilter() : m_pin(this) {
    InitializeCriticalSection(&m_cs);
}
CFormatBoyDSFilter::~CFormatBoyDSFilter() {
    DeleteCriticalSection(&m_cs);
}

HRESULT CFormatBoyDSFilter::CreateInstance(REFIID riid, void** ppv) {
    *ppv = nullptr;
    auto* p = new (std::nothrow) CFormatBoyDSFilter();
    if (!p) return E_OUTOFMEMORY;
    HRESULT hr = p->QueryInterface(riid, ppv);
    p->Release();
    return hr;
}

STDMETHODIMP CFormatBoyDSFilter::QueryInterface(REFIID riid, void** ppv) {
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
STDMETHODIMP_(ULONG) CFormatBoyDSFilter::AddRef()  { return ++m_ref; }
STDMETHODIMP_(ULONG) CFormatBoyDSFilter::Release() {
    ULONG r = --m_ref;
    if (r == 0) delete this;
    return r;
}

STDMETHODIMP CFormatBoyDSFilter::GetClassID(CLSID* p) {
    if (!p) return E_POINTER;
    *p = CLSID_FormatBoyVirtualCameraDS;
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::Stop() {
    m_pin.Inactive();
    EnterCriticalSection(&m_cs);
    m_state = State_Stopped;
    LeaveCriticalSection(&m_cs);
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::Pause() {
    EnterCriticalSection(&m_cs);
    m_state = State_Paused;
    LeaveCriticalSection(&m_cs);
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::Run(REFERENCE_TIME) {
    EnterCriticalSection(&m_cs);
    m_state = State_Running;
    LeaveCriticalSection(&m_cs);
    m_pin.Active();
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::GetState(DWORD, FILTER_STATE* pState) {
    if (!pState) return E_POINTER;
    *pState = m_state;
    return S_OK;
}
STDMETHODIMP CFormatBoyDSFilter::SetSyncSource(IReferenceClock*) { return S_OK; }
STDMETHODIMP CFormatBoyDSFilter::GetSyncSource(IReferenceClock** pp) {
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

STDMETHODIMP CFormatBoyDSFilter::EnumPins(IEnumPins** pp) {
    if (!pp) return E_POINTER;
    *pp = new (std::nothrow) CEnumPins(static_cast<IPin*>(&m_pin));
    return *pp ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CFormatBoyDSFilter::FindPin(LPCWSTR id, IPin** pp) {
    if (!pp) return E_POINTER;
    if (wcscmp(id, L"Output") == 0) {
        *pp = static_cast<IPin*>(&m_pin);
        (*pp)->AddRef();
        return S_OK;
    }
    *pp = nullptr;
    return VFW_E_NOT_FOUND;
}

STDMETHODIMP CFormatBoyDSFilter::QueryFilterInfo(FILTER_INFO* pfi) {
    if (!pfi) return E_POINTER;
    wcscpy_s(pfi->achName, kCameraFriendlyName);
    pfi->pGraph = m_pGraph;
    if (pfi->pGraph) pfi->pGraph->AddRef();
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::JoinFilterGraph(IFilterGraph* pGraph, LPCWSTR pName) {
    m_pGraph = pGraph;
    if (pName) wcscpy_s(m_name, pName);
    return S_OK;
}

STDMETHODIMP CFormatBoyDSFilter::QueryVendorInfo(LPWSTR* pp) {
    if (pp) *pp = nullptr; return E_NOTIMPL;
}

// ===========================================================================
// CFormatBoyOutputPin
// ===========================================================================

CFormatBoyOutputPin::CFormatBoyOutputPin(CFormatBoyDSFilter* f) : m_pFilter(f) {
    InitializeCriticalSection(&m_cs);
}

CFormatBoyOutputPin::~CFormatBoyOutputPin() {
    Inactive();
    if (m_pView)   { UnmapViewOfFile(m_pView);  m_pView = nullptr; }
    if (m_hMap)    { CloseHandle(m_hMap);        m_hMap  = NULL; }
    if (m_hFile != INVALID_HANDLE_VALUE) { CloseHandle(m_hFile); m_hFile = INVALID_HANDLE_VALUE; }
    if (m_pAlloc)  { m_pAlloc->Release();        m_pAlloc = nullptr; }
    if (m_pMemInput){ m_pMemInput->Release();    m_pMemInput = nullptr; }
    DeleteCriticalSection(&m_cs);
}

STDMETHODIMP CFormatBoyOutputPin::QueryInterface(REFIID riid, void** ppv) {
    if (!ppv) return E_POINTER;
    *ppv = nullptr;
    if (riid == IID_IUnknown || riid == IID_IPin) {
        *ppv = static_cast<IPin*>(this); AddRef(); return S_OK;
    }
    if (riid == IID_IQualityControl) {
        *ppv = static_cast<IQualityControl*>(this); AddRef(); return S_OK;
    }
    return E_NOINTERFACE;
}
STDMETHODIMP_(ULONG) CFormatBoyOutputPin::AddRef()  { return ++m_ref; }
STDMETHODIMP_(ULONG) CFormatBoyOutputPin::Release() {
    // Pin is owned by filter — don't delete independently
    return --m_ref;
}

bool CFormatBoyOutputPin::FillMediaType(AM_MEDIA_TYPE* pmt) const {
    return BuildYuy2MediaType(pmt);
}

STDMETHODIMP CFormatBoyOutputPin::Connect(IPin* pReceivePin, const AM_MEDIA_TYPE* pmt) {
    if (!pReceivePin) return E_POINTER;

    AM_MEDIA_TYPE mt = {};
    if (pmt) {
        if (pmt->majortype != MEDIATYPE_Video) return VFW_E_TYPE_NOT_ACCEPTED;
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
    if (m_pAlloc) {
        m_pAlloc->SetProperties(&props, &actual);
        m_pAlloc->Commit();
        m_pMemInput->NotifyAllocator(m_pAlloc, FALSE);
    }

    return S_OK;
}

STDMETHODIMP CFormatBoyOutputPin::ReceiveConnection(IPin*, const AM_MEDIA_TYPE*) {
    return E_UNEXPECTED; // output pin doesn't receive connections
}

STDMETHODIMP CFormatBoyOutputPin::Disconnect() {
    Inactive();
    if (m_pMemInput) { m_pMemInput->Release(); m_pMemInput = nullptr; }
    if (m_pConnected){ m_pConnected->Release(); m_pConnected = nullptr; }
    return S_OK;
}

STDMETHODIMP CFormatBoyOutputPin::ConnectedTo(IPin** pp) {
    if (!pp) return E_POINTER;
    *pp = m_pConnected;
    if (*pp) (*pp)->AddRef();
    return *pp ? S_OK : VFW_E_NOT_CONNECTED;
}

STDMETHODIMP CFormatBoyOutputPin::ConnectionMediaType(AM_MEDIA_TYPE* pmt) {
    if (!pmt) return E_POINTER;
    if (!m_pConnected) return VFW_E_NOT_CONNECTED;
    return FillMediaType(pmt) ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CFormatBoyOutputPin::QueryPinInfo(PIN_INFO* pInfo) {
    if (!pInfo) return E_POINTER;
    pInfo->pFilter = static_cast<IBaseFilter*>(m_pFilter);
    if (pInfo->pFilter) pInfo->pFilter->AddRef();
    pInfo->dir = PINDIR_OUTPUT;
    wcscpy_s(pInfo->achName, L"Output");
    return S_OK;
}

STDMETHODIMP CFormatBoyOutputPin::QueryDirection(PIN_DIRECTION* p) {
    if (!p) return E_POINTER;
    *p = PINDIR_OUTPUT;
    return S_OK;
}

STDMETHODIMP CFormatBoyOutputPin::QueryId(LPWSTR* pp) {
    if (!pp) return E_POINTER;
    *pp = (LPWSTR)CoTaskMemAlloc(sizeof(L"Output"));
    if (!*pp) return E_OUTOFMEMORY;
    wcscpy(*pp, L"Output");
    return S_OK;
}

STDMETHODIMP CFormatBoyOutputPin::QueryAccept(const AM_MEDIA_TYPE* pmt) {
    if (!pmt) return E_POINTER;
    if (pmt->majortype != MEDIATYPE_Video) return S_FALSE;
    if (pmt->subtype   != MEDIASUBTYPE_YUY2 &&
        pmt->subtype   != GUID_NULL) return S_FALSE;
    return S_OK;
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

STDMETHODIMP CFormatBoyOutputPin::EnumMediaTypes(IEnumMediaTypes** pp) {
    if (!pp) return E_POINTER;
    *pp = new (std::nothrow) CEnumMT();
    return *pp ? S_OK : E_OUTOFMEMORY;
}

STDMETHODIMP CFormatBoyOutputPin::QueryInternalConnections(IPin**, ULONG* n) {
    if (n) *n = 0; return E_NOTIMPL;
}
STDMETHODIMP CFormatBoyOutputPin::EndOfStream()  { return S_OK; }
STDMETHODIMP CFormatBoyOutputPin::BeginFlush()   { return S_OK; }
STDMETHODIMP CFormatBoyOutputPin::EndFlush()     { return S_OK; }
STDMETHODIMP CFormatBoyOutputPin::NewSegment(REFERENCE_TIME,REFERENCE_TIME,double) { return S_OK; }

// Delivery -------------------------------------------------------------------

HRESULT CFormatBoyOutputPin::TryOpenBridge() {
    if (m_pView) return S_OK;
    const std::wstring bridgePath = GetFileBridgePath();
    m_hFile = CreateFileW(bridgePath.c_str(), GENERIC_READ,
        FILE_SHARE_READ|FILE_SHARE_WRITE|FILE_SHARE_DELETE,
        nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
    if (m_hFile == INVALID_HANDLE_VALUE) return E_FAIL;

    LARGE_INTEGER sz = {};
    if (!GetFileSizeEx(m_hFile, &sz) || sz.QuadPart < (LONGLONG)sizeof(SharedFrameHeader)) {
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

HRESULT CFormatBoyOutputPin::Active() {
    bool was = m_running.exchange(true);
    if (!was) m_thread = std::thread(&CFormatBoyOutputPin::DeliveryThread, this);
    return S_OK;
}

HRESULT CFormatBoyOutputPin::Inactive() {
    m_running = false;
    if (m_thread.joinable()) m_thread.join();
    return S_OK;
}

void CFormatBoyOutputPin::DeliveryThread() {
    constexpr DWORD kFrameMs = 1000 / kDefaultFpsNum;
    uint64_t lastCounter = 0;
    std::vector<uint8_t> scratch;

    while (m_running) {
        Sleep(kFrameMs);

        if (!m_pView && FAILED(TryOpenBridge())) continue;
        if (!m_pMemInput || !m_pAlloc) continue;

        auto* hdr = reinterpret_cast<const SharedFrameHeader*>(m_pView);
        const uint8_t* payload = m_pView + sizeof(SharedFrameHeader);
        if (hdr->magic != kFrameMagic) continue;

        // Seqlock read
        uint32_t seq1, seq2, w = 0, h = 0, pb = 0;
        uint64_t fc = 0;
        bool ok = false;
        for (int i = 0; i < 64; ++i) {
            seq1 = ((volatile const SharedFrameHeader*)hdr)->reserved;
            if (seq1 & 1) { YieldProcessor(); continue; }
            std::atomic_thread_fence(std::memory_order_acquire);
            fc = hdr->frameCounter;
            if (fc == lastCounter) { ok = false; break; }
            w  = hdr->width; h = hdr->height; pb = hdr->payloadBytes;
            if (!w || !h || !pb || pb > 32u*1024u*1024u) break;
            scratch.resize(pb);
            std::memcpy(scratch.data(), payload, pb);
            std::atomic_thread_fence(std::memory_order_acquire);
            seq2 = ((volatile const SharedFrameHeader*)hdr)->reserved;
            if (seq1 == seq2) { ok = true; lastCounter = fc; break; }
        }
        if (!ok || scratch.empty()) continue;

        // Allocate downstream sample
        IMediaSample* pSample = nullptr;
        if (FAILED(m_pAlloc->GetBuffer(&pSample, nullptr, nullptr, 0))) continue;

        BYTE* pData = nullptr;
        if (SUCCEEDED(pSample->GetPointer(&pData))) {
            const DWORD yuy2Size = w * h * 2;
            pSample->SetActualDataLength(yuy2Size);
            BgraToYuy2(scratch.data(), w, h, pData);
        }

        // Set timestamps
        REFERENCE_TIME tStart = (REFERENCE_TIME)GetTickCount64() * 10000;
        REFERENCE_TIME tStop  = tStart + 10000000LL / kDefaultFpsNum;
        pSample->SetTime(&tStart, &tStop);
        pSample->SetSyncPoint(TRUE);
        pSample->SetDiscontinuity(FALSE);

        m_pMemInput->Receive(pSample);
        pSample->Release();
    }
}

// BGRA → YUY2 ----------------------------------------------------------------
// YUY2 packing: [Y0, Cb, Y1, Cr] per 2-pixel horizontal pair
// Input BGRA: [B, G, R, A]

void CFormatBoyOutputPin::BgraToYuy2(const uint8_t* bgra, uint32_t w, uint32_t h,
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
