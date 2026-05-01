#pragma once
#include <cstdint>

// Magic: "FBCM" (Format-Boy CaM)
static constexpr uint32_t kFrameMagic       = 0x4642434D;
static constexpr uint32_t kProtocolVersion  = 1;
static constexpr uint32_t kPixelFormatBgra32 = 1;

// ---------------------------------------------------------------------------
// SharedFrameHeader — sits at byte 0 of the file bridge / shared memory.
// Payload follows immediately after this struct.
//
// Seqlock protocol (reserved field):
//   Publisher: reserved += 1 (odd)  → write → frameCounter += 1 → reserved += 1 (even)
//   Reader:    spin until reserved is even, read data, verify reserved unchanged.
//   CRITICAL: frameCounter MUST be the last field written inside the write window.
// ---------------------------------------------------------------------------
#pragma pack(push, 1)
struct SharedFrameHeader {
    uint32_t magic;                   // 0x4642434D ("FBCM")
    uint32_t version;                 // protocol version (currently 1)
    uint32_t width;                   // frame width in pixels
    uint32_t height;                  // frame height in pixels
    uint32_t stride;                  // bytes per row (width * 4 for BGRA)
    uint32_t pixelFormat;             // 1 = BGRA32
    uint32_t fpsNumerator;            // e.g. 30
    uint32_t fpsDenominator;          // e.g. 1
    uint32_t payloadBytes;            // total pixel bytes (stride * height)
    uint32_t reserved;                // seqlock sequence counter
    uint64_t frameCounter;            // monotonically increasing frame number
    int64_t  timestampHundredsOfNs;   // wall-clock timestamp (100 ns units)
};
#pragma pack(pop)

static_assert(sizeof(SharedFrameHeader) == 56,
    "SharedFrameHeader size mismatch — update pipe header protocol if changed");

// ---------------------------------------------------------------------------
// PipeFrameHeader — 40-byte little-endian header sent over stdin from Electron
// before each raw BGRA payload.
// ---------------------------------------------------------------------------
#pragma pack(push, 1)
struct PipeFrameHeader {
    uint32_t magic;                   // 0x4642434D
    uint32_t version;                 // 1
    uint32_t width;
    uint32_t height;
    uint32_t stride;                  // width * 4
    uint32_t fps;                     // e.g. 30
    uint32_t flags;                   // reserved, set to 1
    uint32_t payloadBytes;            // stride * height
    int64_t  timestampHundredsOfNs;   // Date.now() * 10000
};
#pragma pack(pop)

static_assert(sizeof(PipeFrameHeader) == 40,
    "PipeFrameHeader size mismatch — must stay at 40 bytes to match Electron");
