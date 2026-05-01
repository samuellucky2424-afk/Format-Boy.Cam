#pragma once
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <cstdint>

// ---------------------------------------------------------------------------
// FormatBoyPublisher
// Opens the file bridge at kFileBridgePath, writes BGRA frames using the
// seqlock protocol defined in formatboy_protocol.h.
// ---------------------------------------------------------------------------
class FormatBoyPublisher {
public:
    FormatBoyPublisher();
    ~FormatBoyPublisher();

    // Open the file bridge.  Must be called once before WriteFrame.
    bool Open(uint32_t width, uint32_t height,
              uint32_t fpsNum = 30, uint32_t fpsDen = 1);

    // Write one BGRA frame.  dataBytes must equal stride*height.
    // Returns false if the bridge is not open or the write fails.
    bool WriteFrame(const uint8_t* bgraData,
                    uint32_t       dataBytes,
                    int64_t        timestampHundredsOfNs);

    void Close();

    bool IsOpen() const { return m_pView != nullptr; }

private:
    bool CreateFileBridge();
    bool EnsureBridgeDirectory() const;

    HANDLE   m_hFile     = INVALID_HANDLE_VALUE;
    HANDLE   m_hMapping  = NULL;
    uint8_t* m_pView     = nullptr;

    uint32_t m_width     = 0;
    uint32_t m_height    = 0;
    uint32_t m_stride    = 0;
    uint32_t m_fpsNum    = 30;
    uint32_t m_fpsDen    = 1;
    size_t   m_totalSize = 0;
};
