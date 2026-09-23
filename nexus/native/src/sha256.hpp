#pragma once

#include <string>

namespace nexus {

std::string sha256_file(const std::string & path);
std::string sha256_text(const std::string & text);

} // namespace nexus
