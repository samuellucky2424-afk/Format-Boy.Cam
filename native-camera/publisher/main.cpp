// henshin_cam_pipe_publisher — reads BGRA frames from stdin (written by
// Electron) and writes them to the file bridge for the MF/DS camera DLLs.
//
// Stdin protocol (40-byte PipeFrameHeader followed by raw BGRA payload):
//   magic(4) version(4) width(4) height(4) stride(4) fps(4) flags(4)
//   payloadBytes(4) timestampHundredsOfNs(8)  — all little-endian

#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <windows.h>
#include <io.h>
#include <fcntl.h>
#include <cstdio>
#include <cstring>
#include <vector>

#include "henshin_publisher.h"
#include "../henshin_protocol.h"
#include "../henshin_ids.h"

// ---------------------------------------------------------------------------
// ReadAll — blocks until exactly `count` bytes have been read from `h`.
// Returns false if the pipe is closed or an error occurs.
// ---------------------------------------------------------------------------
static bool ReadAll(HANDLE h, void* buf, DWORD count) {
    DWORD total = 0;
    while (total < count) {
        DWORD got = 0;
        if (!ReadFile(h, static_cast<char*>(buf) + total,
                      count - total, &got, nullptr) || got == 0) {
            return false;
        }
        total += got;
    }
    return true;
}

// ---------------------------------------------------------------------------
int main() {
    // Must be binary — Windows otherwise translates \r\n in the pixel stream
    _setmode(_fileno(stdin), _O_BINARY);

    HANDLE hStdin = GetStdHandle(STD_INPUT_HANDLE);
    if (hStdin == INVALID_HANDLE_VALUE || hStdin == nullptr) return 1;

    HenshinPublisher publisher;
    std::vector<uint8_t> pixelBuf(
        static_cast<size_t>(kDefaultWidth) * kDefaultHeight * 4, 0);

    if (!publisher.Open(kDefaultWidth, kDefaultHeight, kDefaultFpsNum, kDefaultFpsDen) ||
        !publisher.WriteFrame(pixelBuf.data(), static_cast<uint32_t>(pixelBuf.size()), 0)) {
        std::fprintf(stderr, "[vcam] Could not initialize the frame bridge (error %lu)\n",
                     GetLastError());
        return 2;
    }

    for (;;) {
        // ----------------------------------------------------------------
        // 1. Read the 40-byte pipe header
        // ----------------------------------------------------------------
        PipeFrameHeader ph = {};
        if (!ReadAll(hStdin, &ph, sizeof(PipeFrameHeader))) break;

        // Validate magic & version
        if (ph.magic != kFrameMagic || ph.version != kProtocolVersion) break;

        const uint32_t expectedBytes = kDefaultWidth * kDefaultHeight * 4;
        if (ph.width != kDefaultWidth || ph.height != kDefaultHeight ||
            ph.stride != kDefaultWidth * 4 || ph.fps != kDefaultFpsNum ||
            ph.payloadBytes != expectedBytes) break;

        // ----------------------------------------------------------------
        // 3. Read pixel payload
        // ----------------------------------------------------------------
        pixelBuf.resize(ph.payloadBytes);
        if (!ReadAll(hStdin, pixelBuf.data(), ph.payloadBytes)) break;

        // ----------------------------------------------------------------
        // 4. Write to file bridge
        // ----------------------------------------------------------------
        if (!publisher.WriteFrame(pixelBuf.data(),
                                  ph.payloadBytes,
                                  ph.timestampHundredsOfNs)) break;
    }

    publisher.Close();
    return 0;
}
