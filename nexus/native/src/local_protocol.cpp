#include "local_protocol.hpp"

#include <array>
#include <cerrno>
#include <cstdint>
#include <cstring>
#include <stdexcept>
#include <string>

#include <sys/socket.h>
#include <sys/un.h>
#include <unistd.h>

namespace nexus {
namespace {

constexpr char kBase64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

int decode_base64_character(char character) {
    if (character >= 'A' && character <= 'Z') return character - 'A';
    if (character >= 'a' && character <= 'z') return character - 'a' + 26;
    if (character >= '0' && character <= '9') return character - '0' + 52;
    if (character == '+') return 62;
    if (character == '/') return 63;
    return -1;
}

} // namespace

std::string base64_encode(const std::string & value) {
    std::string result;
    result.reserve(((value.size() + 2u) / 3u) * 4u);
    for (size_t i = 0; i < value.size(); i += 3u) {
        const unsigned char a = static_cast<unsigned char>(value[i]);
        const unsigned char b = i + 1u < value.size() ? static_cast<unsigned char>(value[i + 1u]) : 0u;
        const unsigned char c = i + 2u < value.size() ? static_cast<unsigned char>(value[i + 2u]) : 0u;
        const uint32_t triple = (static_cast<uint32_t>(a) << 16u)
            | (static_cast<uint32_t>(b) << 8u)
            | static_cast<uint32_t>(c);
        result.push_back(kBase64[(triple >> 18u) & 0x3fu]);
        result.push_back(kBase64[(triple >> 12u) & 0x3fu]);
        result.push_back(i + 1u < value.size() ? kBase64[(triple >> 6u) & 0x3fu] : '=');
        result.push_back(i + 2u < value.size() ? kBase64[triple & 0x3fu] : '=');
    }
    return result;
}

std::string base64_decode(const std::string & value) {
    if ((value.size() % 4u) != 0u) {
        throw std::runtime_error("invalid base64 field length");
    }
    std::string result;
    result.reserve((value.size() / 4u) * 3u);
    for (size_t i = 0; i < value.size(); i += 4u) {
        const int a = decode_base64_character(value[i]);
        const int b = decode_base64_character(value[i + 1u]);
        const int c = value[i + 2u] == '=' ? 0 : decode_base64_character(value[i + 2u]);
        const int d = value[i + 3u] == '=' ? 0 : decode_base64_character(value[i + 3u]);
        if (a < 0 || b < 0 || c < 0 || d < 0) {
            throw std::runtime_error("invalid base64 field");
        }
        const uint32_t triple = (static_cast<uint32_t>(a) << 18u)
            | (static_cast<uint32_t>(b) << 12u)
            | (static_cast<uint32_t>(c) << 6u)
            | static_cast<uint32_t>(d);
        result.push_back(static_cast<char>((triple >> 16u) & 0xffu));
        if (value[i + 2u] != '=') result.push_back(static_cast<char>((triple >> 8u) & 0xffu));
        if (value[i + 3u] != '=') result.push_back(static_cast<char>(triple & 0xffu));
    }
    return result;
}

void write_all(int fd, const std::string & value) {
    size_t offset = 0;
    while (offset < value.size()) {
        const ssize_t written = write(fd, value.data() + offset, value.size() - offset);
        if (written < 0) {
            if (errno == EINTR) continue;
            throw std::runtime_error(std::string("socket write failed: ") + std::strerror(errno));
        }
        if (written == 0) {
            throw std::runtime_error("socket write returned zero");
        }
        offset += static_cast<size_t>(written);
    }
}

std::string read_line(int fd, size_t max_bytes) {
    std::string result;
    result.reserve(256u);
    while (result.size() < max_bytes) {
        char character = '\0';
        const ssize_t count = read(fd, &character, 1u);
        if (count == 0) break;
        if (count < 0) {
            if (errno == EINTR) continue;
            throw std::runtime_error(std::string("socket read failed: ") + std::strerror(errno));
        }
        if (character == '\n') return result;
        result.push_back(character);
    }
    if (result.size() >= max_bytes) {
        throw std::runtime_error("socket request exceeds maximum size");
    }
    return result;
}

int connect_unix_socket(const std::string & path) {
    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) {
        throw std::runtime_error(std::string("socket creation failed: ") + std::strerror(errno));
    }
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    if (path.size() >= sizeof(address.sun_path)) {
        close(fd);
        throw std::runtime_error("Unix socket path is too long");
    }
    std::strncpy(address.sun_path, path.c_str(), sizeof(address.sun_path) - 1u);
    if (connect(fd, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) < 0) {
        const std::string message = std::strerror(errno);
        close(fd);
        throw std::runtime_error("socket connection failed: " + message);
    }
    return fd;
}

} // namespace nexus
