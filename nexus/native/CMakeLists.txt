cmake_minimum_required(VERSION 3.16)
project(nexus-runtime VERSION 0.1.0 LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Build only the embedded libllama library. NEXUS does not use llama-server,
# the upstream HTTP server, or unrelated examples/tools.
set(LLAMA_BUILD_COMMON OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_TOOLS OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_SERVER OFF CACHE BOOL "" FORCE)
set(LLAMA_BUILD_LLAMA_CLI OFF CACHE BOOL "" FORCE)
set(GGML_NATIVE OFF CACHE BOOL "" FORCE)
set(GGML_OPENMP OFF CACHE BOOL "" FORCE)
set(GGML_LLAMAFILE OFF CACHE BOOL "" FORCE)
set(LLAMA_OPENSSL OFF CACHE BOOL "" FORCE)
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)

add_subdirectory(${CMAKE_CURRENT_LIST_DIR}/../../third_party/llama.cpp ${CMAKE_BINARY_DIR}/llama.cpp)

add_library(nexus-core STATIC
  src/corpus_store.cpp
  src/sha256.cpp
)
target_include_directories(nexus-core PUBLIC ${CMAKE_CURRENT_LIST_DIR}/src)

add_library(nexus-inference STATIC src/inference_runtime.cpp)
target_link_libraries(nexus-inference PUBLIC nexus-core llama)
target_include_directories(nexus-inference PUBLIC
  ${CMAKE_CURRENT_LIST_DIR}/src
  ${CMAKE_CURRENT_LIST_DIR}/../../third_party/llama.cpp/include
)

add_library(nexus-ipc STATIC src/local_protocol.cpp)
target_include_directories(nexus-ipc PUBLIC ${CMAKE_CURRENT_LIST_DIR}/src)

add_executable(nexus-runtime src/main.cpp)
target_link_libraries(nexus-runtime PRIVATE nexus-core llama)
target_include_directories(nexus-runtime PRIVATE ${CMAKE_CURRENT_LIST_DIR}/../../third_party/llama.cpp/include)

target_compile_options(nexus-runtime PRIVATE
  -Wall
  -Wextra
  -Wpedantic
  -Wconversion
  -Wshadow
)

add_executable(nexus-corpus-selftest src/corpus_selftest.cpp)
target_link_libraries(nexus-corpus-selftest PRIVATE nexus-core)
target_compile_options(nexus-corpus-selftest PRIVATE
  -Wall
  -Wextra
  -Wpedantic
  -Wconversion
  -Wshadow
)

add_executable(nexusd src/nexusd.cpp)
target_link_libraries(nexusd PRIVATE nexus-inference nexus-ipc nexus-core llama)
target_include_directories(nexusd PRIVATE
  ${CMAKE_CURRENT_LIST_DIR}/src
  ${CMAKE_CURRENT_LIST_DIR}/../../third_party/llama.cpp/include
)

add_executable(nexus-cli src/nexus_cli.cpp)
target_link_libraries(nexus-cli PRIVATE nexus-ipc)
target_include_directories(nexus-cli PRIVATE ${CMAKE_CURRENT_LIST_DIR}/src)

install(TARGETS nexus-runtime RUNTIME DESTINATION bin)
