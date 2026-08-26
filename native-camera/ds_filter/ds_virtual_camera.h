#pragma once
// DirectShow Virtual Camera Filter — Henshin (Windows 10 / OBS support)
// Reads from the same file bridge as the MF source.
// Output pin provides YUY2 @ 1280×720 @ 30fps.

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <dshow.h>
#include <ks.h>
#include <ksmedia.h>
#include <ksproxy.h>
#include <atomic>
#include <thread>
#include <cstdint>

#pragma comment(lib, "strmiids.lib")

// ============================================================================
// CHenshinOutputPin
// Push-source output pin.  Runs a thread that reads the file bridge,
// converts BGRA→YUY2, and calls IMemInputPin::Receive on the downstream pin.
// ============================================================================
class CHenshinDSFilter;

class CHenshinOutputPin
    : public IPin
    , public IQualityControl
    , public IAMStreamConfig
    , public IKsPropertySet
{
public:
    explicit CHenshinOutputPin(CHenshinDSFilter* pFilter);
    ~CHenshinOutputPin();

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;

    // IPin
    STDMETHOD(Connect)(IPin* pReceivePin, const AM_MEDIA_TYPE* pmt) override;
    STDMETHOD(ReceiveConnection)(IPin* pConnector, const AM_MEDIA_TYPE* pmt) override;
    STDMETHOD(Disconnect)() override;
    STDMETHOD(ConnectedTo)(IPin** ppPin) override;
    STDMETHOD(ConnectionMediaType)(AM_MEDIA_TYPE* pmt) override;
    STDMETHOD(QueryPinInfo)(PIN_INFO* pInfo) override;
    STDMETHOD(QueryDirection)(PIN_DIRECTION* pPinDir) override;
    STDMETHOD(QueryId)(LPWSTR* Id) override;
    STDMETHOD(QueryAccept)(const AM_MEDIA_TYPE* pmt) override;
    STDMETHOD(EnumMediaTypes)(IEnumMediaTypes** ppEnum) override;
    STDMETHOD(QueryInternalConnections)(IPin** apPin, ULONG* nPin) override;
    STDMETHOD(EndOfStream)() override;
    STDMETHOD(BeginFlush)() override;
    STDMETHOD(EndFlush)() override;
    STDMETHOD(NewSegment)(REFERENCE_TIME tStart, REFERENCE_TIME tStop,
                          double dRate) override;

    // IQualityControl
    STDMETHOD(Notify)(IBaseFilter* pSelf, Quality q) override { return S_OK; }
    STDMETHOD(SetSink)(IQualityControl* piqc) override { return S_OK; }

    // IAMStreamConfig
    STDMETHOD(SetFormat)(AM_MEDIA_TYPE* pmt) override;
    STDMETHOD(GetFormat)(AM_MEDIA_TYPE** ppmt) override;
    STDMETHOD(GetNumberOfCapabilities)(int* piCount, int* piSize) override;
    STDMETHOD(GetStreamCaps)(int iIndex, AM_MEDIA_TYPE** ppmt, BYTE* pSCC) override;

    // IKsPropertySet
    STDMETHOD(Set)(REFGUID guidPropSet, DWORD dwID,
                   LPVOID pInstanceData, DWORD cbInstanceData,
                   LPVOID pPropData, DWORD cbPropData) override;
    STDMETHOD(Get)(REFGUID guidPropSet, DWORD dwPropID,
                   LPVOID pInstanceData, DWORD cbInstanceData,
                   LPVOID pPropData, DWORD cbPropData,
                   DWORD* pcbReturned) override;
    STDMETHOD(QuerySupported)(REFGUID guidPropSet, DWORD dwPropID,
                              DWORD* pTypeSupport) override;

    // Called by filter
    HRESULT Active();
    HRESULT Inactive();

private:
    void DeliveryThread();
    static void BgraToYuy2(const uint8_t* bgra, uint32_t w, uint32_t h,
                            uint8_t* yuy2);
    bool FillMediaType(AM_MEDIA_TYPE* pmt) const;
    HRESULT TryOpenBridge();
    void CloseBridge();

    CHenshinDSFilter* m_pFilter = nullptr;
    IPin*               m_pConnected = nullptr;  // downstream pin
    IMemInputPin*       m_pMemInput  = nullptr;
    IMemAllocator*      m_pAlloc     = nullptr;

    std::thread       m_thread;
    std::atomic<bool> m_running{false};
    std::atomic<bool> m_resetTimeline{true};

    // File bridge
    HANDLE   m_hFile  = INVALID_HANDLE_VALUE;
    HANDLE   m_hMap   = NULL;
    uint8_t* m_pView  = nullptr;

    CRITICAL_SECTION m_cs;
};

// ============================================================================
// CHenshinDSFilter
// Minimal IBaseFilter implementation for a video capture source.
// ============================================================================
class CHenshinDSFilter
    : public IBaseFilter
    , public IAMFilterMiscFlags
{
public:
    static HRESULT CreateInstance(REFIID riid, void** ppv);

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;

    // IPersist
    STDMETHOD(GetClassID)(CLSID* pClsid) override;

    // IMediaFilter
    STDMETHOD(Stop)() override;
    STDMETHOD(Pause)() override;
    STDMETHOD(Run)(REFERENCE_TIME tStart) override;
    STDMETHOD(GetState)(DWORD dwMSecs, FILTER_STATE* State) override;
    STDMETHOD(SetSyncSource)(IReferenceClock* pClock) override;
    STDMETHOD(GetSyncSource)(IReferenceClock** ppClock) override;

    // IBaseFilter
    STDMETHOD(EnumPins)(IEnumPins** ppEnum) override;
    STDMETHOD(FindPin)(LPCWSTR Id, IPin** ppPin) override;
    STDMETHOD(QueryFilterInfo)(FILTER_INFO* pInfo) override;
    STDMETHOD(JoinFilterGraph)(IFilterGraph* pGraph, LPCWSTR pName) override;
    STDMETHOD(QueryVendorInfo)(LPWSTR* pVendorInfo) override;

    // IAMFilterMiscFlags
    STDMETHOD_(ULONG, GetMiscFlags)() override { return AM_FILTER_MISC_FLAGS_IS_SOURCE; }

    IFilterGraph*  m_pGraph = nullptr;

private:
    CHenshinDSFilter();
    ~CHenshinDSFilter();

    std::atomic<ULONG>  m_ref{1};
    FILTER_STATE        m_state = State_Stopped;
    CHenshinOutputPin m_pin;
    wchar_t             m_name[128] = {};
    CRITICAL_SECTION    m_cs;
};
