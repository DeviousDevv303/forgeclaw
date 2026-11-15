#pragma once

#include <cstddef>
#include <string>

namespace nexus {

std::string base64_encode(const std::string & value);
std::string base64_decode(const std::string & value);
void write_all(int fd, const std::string & value);
std::string read_line(int fd, size_t max_bytes = 1024u * 1024u);
int connect_unix_socket(const std::string & path);

} // namespace nexus
