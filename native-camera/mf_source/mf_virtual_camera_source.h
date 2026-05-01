#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <mfapi.h>
#include <mfidl.h>
#include <mferror.h>
#include <wrl/client.h>
#include <atomic>
#include <deque>
#include <thread>
#include <vector>
#include <cstdint>
#include "../formatboy_ids.h"

using Microsoft::WRL::ComPtr;

struct __declspec(uuid("28F54685-06FD-11D2-B27A-00A0C9223196")) IKsControl : public IUnknown {
    virtual HRESULT STDMETHODCALLTYPE KsProperty(
        void* Property,
        ULONG PropertyLength,
        LPVOID PropertyData,
        ULONG DataLength,
        ULONG* BytesReturned) = 0;
    virtual HRESULT STDMETHODCALLTYPE KsMethod(
        void* Method,
        ULONG MethodLength,
        LPVOID MethodData,
        ULONG DataLength,
        ULONG* BytesReturned) = 0;
    virtual HRESULT STDMETHODCALLTYPE KsEvent(
        void* Event,
        ULONG EventLength,
        LPVOID EventData,
        ULONG DataLength,
        ULONG* BytesReturned) = 0;
};

// Forward declaration
class FormatBoyMFStream;

// ============================================================================
// FormatBoyMFSource
// Implements IMFMediaSourceEx + IMFGetService.
// Reads BGRA frames from the file bridge, converts to NV12, and delivers
// them to FormatBoyMFStream at 30 fps.
// ============================================================================
class FormatBoyMFSource
    : public IMFMediaSourceEx   // extends IMFMediaSource — required by FrameServer
    , public IMFGetService
    , public IKsControl
{
public:
    static HRESULT CreateInstance(REFIID riid, void** ppv);

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;

    // IMFMediaEventGenerator
    STDMETHOD(GetEvent)(DWORD dwFlags, IMFMediaEvent** ppEvent) override;
    STDMETHOD(BeginGetEvent)(IMFAsyncCallback* pCallback, IUnknown* pState) override;
    STDMETHOD(EndGetEvent)(IMFAsyncResult* pResult, IMFMediaEvent** ppEvent) override;
    STDMETHOD(QueueEvent)(MediaEventType met, REFGUID ext,
                          HRESULT hr, const PROPVARIANT* pv) override;

    // IMFMediaSource
    STDMETHOD(GetCharacteristics)(DWORD* pdw) override;
    STDMETHOD(CreatePresentationDescriptor)(IMFPresentationDescriptor** ppPD) override;
    STDMETHOD(Start)(IMFPresentationDescriptor* pPD, const GUID* pFormat,
                     const PROPVARIANT* pStart) override;
    STDMETHOD(Stop)() override;
    STDMETHOD(Pause)() override;
    STDMETHOD(Shutdown)() override;

    // IMFMediaSourceEx
    STDMETHOD(GetSourceAttributes)(IMFAttributes** ppAttributes) override;
    STDMETHOD(GetStreamAttributes)(DWORD dwStreamIdentifier,
                                   IMFAttributes** ppAttributes) override;
    STDMETHOD(SetD3DManager)(IUnknown* pManager) override;

    // IMFGetService
    STDMETHOD(GetService)(REFGUID guidService, REFIID riid, LPVOID* ppv) override;

    // IKsControl
    STDMETHOD(KsProperty)(void* Property, ULONG PropertyLength,
                          LPVOID PropertyData, ULONG DataLength,
                          ULONG* BytesReturned) override;
    STDMETHOD(KsMethod)(void* Method, ULONG MethodLength,
                        LPVOID MethodData, ULONG DataLength,
                        ULONG* BytesReturned) override;
    STDMETHOD(KsEvent)(void* Event, ULONG EventLength,
                       LPVOID EventData, ULONG DataLength,
                       ULONG* BytesReturned) override;

    // Called by FormatBoyMFStream
    void DeliverBridgeFrame();

private:
    FormatBoyMFSource();
    ~FormatBoyMFSource();

    HRESULT Initialize();
    HRESULT InitializeAttributeStores();
    void    ResetCachedFrameState();
    HRESULT TryOpenFileBridge();
    void    DeliveryLoop();

    std::atomic<ULONG> m_ref{1};

    ComPtr<IMFMediaEventQueue>        m_eventQueue;
    ComPtr<IMFPresentationDescriptor> m_pDesc;
    ComPtr<IMFAttributes>             m_sourceAttributes;
    ComPtr<IMFAttributes>             m_streamAttributes;
    ComPtr<IUnknown>                  m_d3dManager;
    FormatBoyMFStream*                m_pStream = nullptr;

    // File bridge
    HANDLE   m_hFile    = INVALID_HANDLE_VALUE;
    HANDLE   m_hMap     = NULL;
    uint8_t* m_pView    = nullptr;

    // Delivery thread
    std::thread       m_thread;
    std::atomic<bool> m_running{false};
    bool              m_shutdown = false;
    std::vector<uint8_t> m_cachedFrame;
    uint32_t             m_cachedWidth  = 0;
    uint32_t             m_cachedHeight = 0;
    uint32_t             m_cachedStride = 0;

    CRITICAL_SECTION m_cs;
};

// ============================================================================
// FormatBoyMFStream
// Implements IMFMediaStream.
// Receives NV12 samples from FormatBoyMFSource and queues MEMediaSample events.
// ============================================================================
class FormatBoyMFStream : public IMFMediaStream
{
public:
    explicit FormatBoyMFStream(FormatBoyMFSource* pSource);
    ~FormatBoyMFStream();

    HRESULT Initialize(uint32_t width, uint32_t height,
                       uint32_t fpsNum, uint32_t fpsDen);

    // IUnknown
    STDMETHOD(QueryInterface)(REFIID riid, void** ppv) override;
    STDMETHOD_(ULONG, AddRef)() override;
    STDMETHOD_(ULONG, Release)() override;

    // IMFMediaEventGenerator
    STDMETHOD(GetEvent)(DWORD dwFlags, IMFMediaEvent** ppEvent) override;
    STDMETHOD(BeginGetEvent)(IMFAsyncCallback* pCallback, IUnknown* pState) override;
    STDMETHOD(EndGetEvent)(IMFAsyncResult* pResult, IMFMediaEvent** ppEvent) override;
    STDMETHOD(QueueEvent)(MediaEventType met, REFGUID ext,
                          HRESULT hr, const PROPVARIANT* pv) override;

    // IMFMediaStream
    STDMETHOD(GetMediaSource)(IMFMediaSource** ppSource) override;
    STDMETHOD(GetStreamDescriptor)(IMFStreamDescriptor** ppSD) override;
    STDMETHOD(RequestSample)(IUnknown* pToken) override;

    // Called by the delivery thread — creates and queues one NV12 sample
    HRESULT DeliverSample(const uint8_t* bgra, uint32_t w, uint32_t h,
                          IUnknown* token);
    bool HasPendingSampleRequest();
    void ResetStreamingState();

    // Static BGRA→NV12 converter (public so tests can call it)
    static void BgraToNv12(const uint8_t* bgra, uint32_t w, uint32_t h,
                            uint8_t* nv12);
    static void BgraToYuy2(const uint8_t* bgra, uint32_t w, uint32_t h,
                            uint8_t* yuy2);

private:
    std::atomic<ULONG> m_ref{1};

    FormatBoyMFSource*          m_pSource = nullptr;
    ComPtr<IMFMediaEventQueue>  m_eventQueue;
    ComPtr<IMFStreamDescriptor> m_streamDesc;

    uint32_t m_width  = kDefaultWidth;
    uint32_t m_height = kDefaultHeight;
    uint32_t m_fpsNum = kDefaultFpsNum;
    uint32_t m_fpsDen = kDefaultFpsDen;
    LONGLONG m_nextSampleTimeHns = 0;
    LONGLONG m_sampleDurationHns = 0;
    bool     m_hasSampleClock    = false;
    GUID     m_lastLoggedSubtype = {};

    // Consumers can pipeline multiple RequestSample calls during call setup;
    // preserve them all so the stream never drops demand and stalls.
    std::deque<IUnknown*> m_pendingTokens;
    CRITICAL_SECTION m_cs;
};
