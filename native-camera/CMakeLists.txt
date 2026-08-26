cmake_minimum_required(VERSION 3.20)
if(POLICY CMP0091)
    cmake_policy(SET CMP0091 NEW)
endif()
project(HenshinCameraNative CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Ship self-contained MSVC binaries. This applies /MT (or /MTd for Debug) to
# every executable and DLL target and avoids a Visual C++ Redistributable
# dependency on customer machines.
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

# Decode source files as UTF-8 so Japanese product labels remain intact in
# Windows registry values and native application output.
if(MSVC)
    add_compile_options(/utf-8)
endif()

if(NOT WIN32)
    message(FATAL_ERROR "HenshinCameraNative is Windows-only")
endif()

# Global definitions — Unicode APIs + Windows 10 targeting
# WIN32_LEAN_AND_MEAN and NOMINMAX are defined per-source-file to avoid
# redefinition warnings from the compiler.
add_compile_definitions(
    UNICODE
    _UNICODE
    _WIN32_WINNT=0x0A00          # Windows 10+
    NTDDI_VERSION=0x0A00000B    # Windows 11 21H2 — required for mfvirtualcamera.h
)

# All output goes to Release/ so afterPack.cjs can find them easily
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY         ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY_DEBUG   ${CMAKE_BINARY_DIR}/Debug)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY         ${CMAKE_BINARY_DIR}/Release)
set(CMAKE_LIBRARY_OUTPUT_DIRECTORY_RELEASE ${CMAKE_BINARY_DIR}/Release)

# ============================================================================
# 1. henshin_cam_pipe_publisher.exe
#    Console app — receives BGRA frames from Electron stdin, writes file bridge.
# ============================================================================
add_executable(henshin_cam_pipe_publisher
    publisher/main.cpp
    publisher/henshin_publisher.cpp
)
target_include_directories(henshin_cam_pipe_publisher PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(henshin_cam_pipe_publisher PRIVATE
    kernel32 advapi32 ole32 shlwapi shell32
)
set_target_properties(henshin_cam_pipe_publisher PROPERTIES
    WIN32_EXECUTABLE FALSE   # console subsystem
)

# ============================================================================
# 2. HenshinVirtualCameraMF.dll
#    Media Foundation virtual camera source (Windows 11+).
#    Session 0 / FrameServer loads this DLL.
# ============================================================================
add_library(HenshinVirtualCameraMF SHARED
    mf_source/dllmain.cpp
    mf_source/mf_virtual_camera_source.cpp
    mf_source/HenshinVirtualCameraMF.def
)
target_include_directories(HenshinVirtualCameraMF PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(HenshinVirtualCameraMF PRIVATE
    mf mfuuid mfplat ole32 oleaut32 kernel32 advapi32 shlwapi shell32
)

# ============================================================================
# 3. HenshinVirtualCamera.dll
#    DirectShow compatibility filter for Windows 10 / OBS / legacy consumers.
# ============================================================================
add_library(HenshinVirtualCamera SHARED
    ds_filter/dllmain_ds.cpp
    ds_filter/ds_virtual_camera.cpp
    ds_filter/HenshinVirtualCamera.def
)
target_include_directories(HenshinVirtualCamera PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(HenshinVirtualCamera PRIVATE
    strmiids ole32 oleaut32 kernel32 advapi32 winmm shlwapi shell32
)

# ============================================================================
# 4. henshin_cam_registrar.exe
#    Elevated utility: install / remove / probe the virtual camera.
# ============================================================================
add_executable(henshin_cam_registrar
    registrar/main.cpp
)
target_include_directories(henshin_cam_registrar PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(henshin_cam_registrar PRIVATE
    mf mfuuid mfplat ole32 oleaut32 kernel32 advapi32 shlwapi shell32
)
set_target_properties(henshin_cam_registrar PROPERTIES
    WIN32_EXECUTABLE FALSE
)
# Embed a UAC manifest so Windows prompts for elevation
if(MSVC)
    set_target_properties(henshin_cam_registrar PROPERTIES
        LINK_FLAGS "/MANIFESTUAC:\"level='requireAdministrator' uiAccess='false'\""
    )
endif()

# ============================================================================
# 5. henshin_cam_mf_smoke.exe
#    Diagnostic utility: enumerate camera devices, open the virtual camera,
#    and read one sample through Media Foundation.
# ============================================================================
add_executable(henshin_cam_mf_smoke
    registrar/mf_smoke.cpp
)
target_include_directories(henshin_cam_mf_smoke PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}
)
target_link_libraries(henshin_cam_mf_smoke PRIVATE
    mf mfuuid mfplat mfreadwrite ole32 oleaut32 kernel32 advapi32 shlwapi
)
set_target_properties(henshin_cam_mf_smoke PROPERTIES
    WIN32_EXECUTABLE FALSE
)
