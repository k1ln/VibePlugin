cmake_minimum_required(VERSION 3.22)
project(VibePlugin VERSION 0.4.6 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# Development build: file logging of the generate/compile pipeline. OFF in
# release. Turn on with scripts/dev.sh (or -DVSTAI_DEV_MODE=ON). See src/DevLog.h.
option(VSTAI_DEV_MODE "Development build with extra logging" OFF)

# Headless engine/knob test (scripts/test.sh). OFF for normal plugin builds.
option(VSTAI_BUILD_TESTS "Build the headless engine/knob test" OFF)

# ---------------------------------------------------------------------------
#  Dependencies
# ---------------------------------------------------------------------------
include(FetchContent)

FetchContent_Declare(
    JUCE
    GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
    GIT_TAG        8.0.4
    GIT_SHALLOW    TRUE)
FetchContent_MakeAvailable(JUCE)

# wasmtime C API. Download a prebuilt "c-api" release for your platform from
#   https://github.com/bytecodealliance/wasmtime/releases
# extract it, and point WASMTIME_DIR at the extracted folder (include/ + lib/).
# wasmtime runs the generated DSP module. (The AssemblyScript compiler is a
# separate bundled JS runtime — see compiler/ — because asc needs WebAssembly.)
set(WASMTIME_DIR "" CACHE PATH "Path to an extracted wasmtime c-api release")
if(NOT WASMTIME_DIR)
    message(FATAL_ERROR "Set WASMTIME_DIR to an extracted wasmtime c-api release.")
endif()
find_path(WASMTIME_INCLUDE_DIR wasmtime.h PATHS "${WASMTIME_DIR}/include" REQUIRED)
find_library(WASMTIME_LIB NAMES wasmtime libwasmtime PATHS "${WASMTIME_DIR}/lib" REQUIRED)

# Windows links wasmtime STATICALLY (lib/wasmtime.lib), not via wasmtime.dll.
# Shipping the DLL inside the bundle does not work: Windows resolves a DLL's
# dependencies against the *host application's* directory (the DAW's folder),
# System32 and PATH — never the loaded DLL's own directory. So a wasmtime.dll
# in Contents/x86_64-win is invisible and the plugin silently fails to load
# (FL Studio just never lists it). Static linking removes the dependency.
#
# The static lib needs WASM_API_EXTERN/WASI_API_EXTERN defined empty so the
# headers stop emitting __declspec(dllimport), plus the Win32 system libs
# linked below in add_vstai_plugin — both per wasmtime.h's own instructions.
if(WIN32 AND WASMTIME_LIB MATCHES "wasmtime\\.dll\\.lib$")
    message(WARNING "WASMTIME_LIB points at the import lib (${WASMTIME_LIB}). "
                    "Use lib/wasmtime.lib instead — a DLL shipped in the bundle "
                    "is not on Windows' DLL search path and the plugin won't load.")
endif()

# The plugin calls https://api.anthropic.com directly. macOS/Windows use native
# TLS; Linux's JUCE networking needs libcurl for HTTPS.
if(UNIX AND NOT APPLE)
    find_package(CURL REQUIRED)
    set(VSTAI_USE_CURL 1)
else()
    set(VSTAI_USE_CURL 0)
endif()

set(VSTAI_SOURCES
    src/PluginProcessor.cpp
    src/PluginEditor.cpp
    src/WebEditor.cpp
    src/LockedEditor.cpp
    src/WasmEngine.cpp
    src/VstaiDocument.cpp
    src/LlmClient.cpp
    src/AssemblyScriptCompiler.cpp)

# macOS: NSEvent keyUp monitor — re-injects keyups the host swallows (FL Studio)
# so GUI keyboard notes release (see src/MacKeyUpMonitor.h).
if(APPLE)
    list(APPEND VSTAI_SOURCES src/MacKeyUpMonitor.mm)
endif()

# A build stamp shown next to the title in the editor header, so it is obvious
# at a glance which build a DAW actually has loaded (hosts cache plugin binaries,
# so "did my rebuild land?" is otherwise guesswork). Regenerated on every
# configure, and scripts/build.sh configures on every run.
string(TIMESTAMP VSTAI_BUILD_STAMP "%Y%m%d-%H%M")
set(VSTAI_BUILD_ID "v${PROJECT_VERSION}-${VSTAI_BUILD_STAMP}")
message(STATUS "vstai: build id ${VSTAI_BUILD_ID}")

# ---------------------------------------------------------------------------
#  One core, two products: an effect and an instrument/synth.
# ---------------------------------------------------------------------------
function(add_vstai_plugin TARGET PRODUCT CODE SYNTH)
    if(SYNTH)
        set(IS_SYNTH TRUE)
        set(SYNTH_DEF 1)
    else()
        set(IS_SYNTH FALSE)
        set(SYNTH_DEF 0)
    endif()

    # COPY_PLUGIN_AFTER_BUILD installs the built plugin into the system folder.
    # macOS (~/Library/...) and Linux (~/.vst3) are user-writable — handy for dev.
    # Windows targets C:\Program Files\Common Files\VST3, which needs admin and
    # makes the build's POST_BUILD step fail in CI (error MSB3073). Off on Windows.
    if(WIN32)
        set(COPY_AFTER_BUILD FALSE)
    else()
        set(COPY_AFTER_BUILD TRUE)
    endif()

    juce_add_plugin(${TARGET}
        PRODUCT_NAME             "${PRODUCT}"
        COMPANY_NAME             "VibePlugin"
        BUNDLE_ID                "de.1ln.${TARGET}"
        PLUGIN_MANUFACTURER_CODE Vsai
        PLUGIN_CODE              ${CODE}
        FORMATS                  VST3 Standalone
        IS_SYNTH                 ${IS_SYNTH}
        NEEDS_MIDI_INPUT         ${IS_SYNTH}
        NEEDS_WEB_BROWSER        TRUE
        # Windows: link the Edge/Chromium WebView2 backend statically. Without it
        # the legacy IWebBrowser2 backend is used, which lacks resource providers
        # (build error C2039 'withResourceProvider'). No-op on macOS/Linux (JUCE
        # reads this only inside its WIN32 branch). Needs the WebView2 SDK at
        # configure time via JUCE_WEBVIEW2_PACKAGE_LOCATION (CI fetches the NuGet).
        NEEDS_WEBVIEW2           TRUE
        COPY_PLUGIN_AFTER_BUILD  ${COPY_AFTER_BUILD})

    target_sources(${TARGET} PRIVATE ${VSTAI_SOURCES})

    target_compile_definitions(${TARGET} PUBLIC
        JUCE_WEB_BROWSER=1
        JUCE_USE_CURL=${VSTAI_USE_CURL}
        JUCE_VST3_CAN_REPLACE_VST2=0
        JUCE_DISPLAY_SPLASH_SCREEN=0
        VSTAI_IS_SYNTH=${SYNTH_DEF}
        VSTAI_DEV_MODE=$<BOOL:${VSTAI_DEV_MODE}>
        VSTAI_BUILD_ID="${VSTAI_BUILD_ID}"
        # Windows: defining this flips JUCE_USE_WIN_WEBVIEW2 on in juce_gui_extra,
        # which is what actually exposes WebBrowserComponent::Options::with-
        # ResourceProvider (the GUI bridge). NEEDS_WEBVIEW2 only links the static
        # loader; it does NOT define this. No-op on macOS/Linux.
        $<$<PLATFORM_ID:Windows>:JUCE_USE_WIN_WEBVIEW2_WITH_STATIC_LINKING=1>
        # Statically-linked wasmtime: drop the headers' __declspec(dllimport).
        $<$<PLATFORM_ID:Windows>:WASM_API_EXTERN=>
        $<$<PLATFORM_ID:Windows>:WASI_API_EXTERN=>)

    # MSVC defaults to the system codepage for both the source and the compiled
    # string literals; without this, the em dashes/ellipses/bullets embedded as
    # literal UTF-8 in the source (e.g. AccountPanel.h) get mis-decoded and show
    # up as mojibake in the UI. No-op on Clang/GCC, which already assume UTF-8.
    target_compile_options(${TARGET} PRIVATE $<$<CXX_COMPILER_ID:MSVC>:/utf-8>)

    target_include_directories(${TARGET} PRIVATE ${WASMTIME_INCLUDE_DIR})

    target_link_libraries(${TARGET} PRIVATE
        ${WASMTIME_LIB}
        juce::juce_audio_utils
        juce::juce_audio_processors
        juce::juce_gui_extra
        juce::juce_data_structures
        juce::juce_core
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)

    if(APPLE)
        target_link_libraries(${TARGET} PRIVATE "-framework Security" "-framework CoreFoundation")
    elseif(UNIX)
        target_link_libraries(${TARGET} PRIVATE pthread dl m)
        if(VSTAI_USE_CURL)
            target_link_libraries(${TARGET} PRIVATE CURL::libcurl)
        endif()
    elseif(WIN32)
        target_link_libraries(${TARGET} PRIVATE ws2_32 advapi32 userenv ntdll shell32 ole32 bcrypt)
    endif()

    # Ship the bundled compiler with each format: copy it into the bundle's
    # Resources/ (where Settings.h also looks). It must be Resources/ and NOT
    # MacOS/: codesign treats every file in Contents/MacOS as a Mach-O code
    # object, and the non-Mach-O asc-bundle.mjs there makes bundle signing fail
    # ("code object is not signed at all"). In Resources/ the .mjs is sealed as
    # a normal resource and vstai-node is signed as nested code. Runs at build
    # time, so building the compiler after configuring still works.
    foreach(FMT VST3 Standalone AU AUv3 LV2 VST AAX Unity)
        if(TARGET ${TARGET}_${FMT})
            add_custom_command(TARGET ${TARGET}_${FMT} POST_BUILD
                COMMAND ${CMAKE_COMMAND}
                        -DSRC_DIR=${CMAKE_CURRENT_SOURCE_DIR}/compiler
                        -DDEST=$<TARGET_FILE_DIR:${TARGET}_${FMT}>/../Resources
                        -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/copy_compiler.cmake
                VERBATIM)

            # Ship the WebView editor UI (shell + Monaco + the standard kit) into
            # Resources/ui. Like the compiler, these are plain sealed resources
            # (no Mach-O), so bundle signing is unaffected. Loaded via WebAssets.h.
            add_custom_command(TARGET ${TARGET}_${FMT} POST_BUILD
                COMMAND ${CMAKE_COMMAND} -E copy_directory_if_different
                        ${CMAKE_CURRENT_SOURCE_DIR}/ui
                        $<TARGET_FILE_DIR:${TARGET}_${FMT}>/../Resources/ui
                VERBATIM)

            # (No wasmtime.dll copy here: Windows links wasmtime statically — see
            # the WASMTIME_LIB note at the top. A DLL beside the plugin binary is
            # never found, because Windows searches the host app's directory.)
        endif()
    endforeach()

    # JUCE's COPY_PLUGIN_AFTER_BUILD installs the VST3 into the user plug-in
    # folder *before* the embed step above runs, so the installed copy would be
    # missing the compiler. Re-embed it into the installed bundle's Resources.
    # (macOS user VST3 folder; this is the path the plugin loads from in a DAW.)
    if(APPLE AND TARGET ${TARGET}_VST3)
        add_custom_command(TARGET ${TARGET}_VST3 POST_BUILD
            COMMAND ${CMAKE_COMMAND}
                    -DSRC_DIR=${CMAKE_CURRENT_SOURCE_DIR}/compiler
                    -DDEST=$ENV{HOME}/Library/Audio/Plug-Ins/VST3/${PRODUCT}.vst3/Contents/Resources
                    -P ${CMAKE_CURRENT_SOURCE_DIR}/cmake/copy_compiler.cmake
            VERBATIM)
        # Always-run sync so the installed bundle (what the DAW loads) gets current
        # UI assets even when only files under ui/ changed (no relink). Cheap: only
        # differing files are copied.
        add_custom_target(${TARGET}_ui_sync ALL
            COMMAND ${CMAKE_COMMAND} -E copy_directory_if_different
                    ${CMAKE_CURRENT_SOURCE_DIR}/ui
                    $ENV{HOME}/Library/Audio/Plug-Ins/VST3/${PRODUCT}.vst3/Contents/Resources/ui
            VERBATIM)
        add_dependencies(${TARGET}_ui_sync ${TARGET}_VST3)
    endif()
endfunction()

add_vstai_plugin(VibePlugin_FX    "VibePlugin FX"    Vsfx 0)   # audio effect
add_vstai_plugin(VibePlugin_Synth "VibePlugin Synth" Vssy 1)   # instrument / synth

# ---------------------------------------------------------------------------
#  Headless test of the knob/note path (scripts/test.sh). Drives the real
#  WasmEngine with the reference modules, or sweeps a .vstai's parameters.
# ---------------------------------------------------------------------------
if(VSTAI_BUILD_TESTS)
    juce_add_console_app(vstai_tests PRODUCT_NAME "vstai_tests")
    target_sources(vstai_tests PRIVATE
        tests/engine_test.cpp
        src/WasmEngine.cpp
        src/VstaiDocument.cpp)
    target_include_directories(vstai_tests PRIVATE
        ${WASMTIME_INCLUDE_DIR} ${CMAKE_CURRENT_SOURCE_DIR}/src)
    target_compile_definitions(vstai_tests PRIVATE JUCE_STANDALONE_APPLICATION=1)
    target_link_libraries(vstai_tests PRIVATE
        ${WASMTIME_LIB}
        juce::juce_audio_basics
        juce::juce_core
        juce::juce_recommended_config_flags
        juce::juce_recommended_warning_flags)
    if(APPLE)
        target_link_libraries(vstai_tests PRIVATE "-framework Security" "-framework CoreFoundation")
    elseif(UNIX)
        target_link_libraries(vstai_tests PRIVATE pthread dl m)
    endif()
endif()

# The bundled compiler (vstai-asc, or vstai-node + asc-bundle.mjs) is copied next
# to each plugin binary automatically at build time (see add_vstai_plugin above).
# Build it once with compiler/build.sh; it's picked up on the next plugin build
# with no reconfigure. If it isn't built, the plugins still build — generation
# just reports the compiler is missing until you run compiler/build.sh (or point
# Config.h / $VSTAI_COMPILER at one).
if(NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/compiler/vstai-asc"
   AND NOT EXISTS "${CMAKE_CURRENT_SOURCE_DIR}/compiler/asc-bundle.mjs")
    message(STATUS "vstai: bundled compiler not built yet — run compiler/build.sh "
                   "(it will be copied into the plugins on the next build).")
endif()

# Optional: bake your API key + settings into the binary by copying
#   src/Config.example.h -> src/Config.h  and editing it (Config.h is gitignored).
