# copy_compiler.cmake
# Run at build time (cmake -P) to drop the bundled AssemblyScript compiler next
# to a freshly built plugin binary, so the plugin is one-step shippable.
#   -DSRC_DIR=<repo>/compiler  -DDEST=<binary dir>
# Copies whichever compiler artefacts exist (single-file vstai-asc, or the
# vstai-node + asc-bundle.mjs pair). No-op if compiler/build.sh hasn't run yet.

get_filename_component(DEST "${DEST}" ABSOLUTE)   # resolve any ../ in the path
file(MAKE_DIRECTORY "${DEST}")

set(_names vstai-asc vstai-asc.exe vstai-node vstai-node.exe asc-bundle.mjs)
set(_copied "")
foreach(_n ${_names})
    set(_src "${SRC_DIR}/${_n}")
    if(EXISTS "${_src}")
        file(COPY "${_src}" DESTINATION "${DEST}")
        if(NOT _n MATCHES "\\.mjs$")
            file(CHMOD "${DEST}/${_n}"
                 PERMISSIONS OWNER_READ OWNER_WRITE OWNER_EXECUTE
                             GROUP_READ GROUP_EXECUTE WORLD_READ WORLD_EXECUTE)
        endif()
        list(APPEND _copied "${_n}")
    endif()
endforeach()

if(_copied)
    message(STATUS "vstai: bundled compiler copied to ${DEST} (${_copied})")
endif()
