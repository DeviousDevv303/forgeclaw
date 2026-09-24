#include "sha256.hpp"

#include <array>
#include <cstdint>
#include <fstream>
#include <iomanip>
#include <sstream>
#include <stdexcept>
#include <string>

namespace nexus {
namespace {

constexpr std::array<uint32_t, 64> kRoundConstants = {
    0x428a2f98u, 0x71374491u, 0xb5c0fbcfu, 0xe9b5dba5u,
    0x3956c25bu, 0x59f111f1u, 0x923f82a4u, 0xab1c5ed5u,
    0xd807aa98u, 0x12835b01u, 0x243185beu, 0x550c7dc3u,
    0x72be5d74u, 0x80deb1feu, 0x9bdc06a7u, 0xc19bf174u,
    0xe49b69c1u, 0xefbe4786u, 0x0fc19dc6u, 0x240ca1ccu,
    0x2de92c6fu, 0x4a7484aau, 0x5cb0a9dcu, 0x76f988dau,
    0x983e5152u, 0xa831c66du, 0xb00327c8u, 0xbf597fc7u,
    0xc6e00bf3u, 0xd5a79147u, 0x06ca6351u, 0x14292967u,
    0x27b70a85u, 0x2e1b2138u, 0x4d2c6dfcu, 0x53380d13u,
    0x650a7354u, 0x766a0abbu, 0x81c2c92eu, 0x92722c85u,
    0xa2bfe8a1u, 0xa81a664bu, 0xc24b8b70u, 0xc76c51a3u,
    0xd192e819u, 0xd6990624u, 0xf40e3585u, 0x106aa070u,
    0x19a4c116u, 0x1e376c08u, 0x2748774cu, 0x34b0bcb5u,
    0x391c0cb3u, 0x4ed8aa4au, 0x5b9cca4fu, 0x682e6ff3u,
    0x748f82eeu, 0x78a5636fu, 0x84c87814u, 0x8cc70208u,
    0x90befffau, 0xa4506cebu, 0xbef9a3f7u, 0xc67178f2u,
};

constexpr std::array<uint32_t, 8> kInitialState = {
    0x6a09e667u, 0xbb67ae85u, 0x3c6ef372u, 0xa54ff53au,
    0x510e527fu, 0x9b05688cu, 0x1f83d9abu, 0x5be0cd19u,
};

uint32_t rotate_right(uint32_t value, uint32_t amount) {
    return (value >> amount) | (value << (32u - amount));
}

void process_block(const uint8_t * block, std::array<uint32_t, 8> & state) {
    std::array<uint32_t, 64> words{};
    for (size_t i = 0; i < 16; ++i) {
        const size_t offset = i * 4;
        words[i] = (static_cast<uint32_t>(block[offset]) << 24u)
            | (static_cast<uint32_t>(block[offset + 1]) << 16u)
            | (static_cast<uint32_t>(block[offset + 2]) << 8u)
            | static_cast<uint32_t>(block[offset + 3]);
    }
    for (size_t i = 16; i < words.size(); ++i) {
        const uint32_t s0 = rotate_right(words[i - 15], 7u)
            ^ rotate_right(words[i - 15], 18u)
            ^ (words[i - 15] >> 3u);
        const uint32_t s1 = rotate_right(words[i - 2], 17u)
            ^ rotate_right(words[i - 2], 19u)
            ^ (words[i - 2] >> 10u);
        words[i] = words[i - 16] + s0 + words[i - 7] + s1;
    }

    uint32_t a = state[0];
    uint32_t b = state[1];
    uint32_t c = state[2];
    uint32_t d = state[3];
    uint32_t e = state[4];
    uint32_t f = state[5];
    uint32_t g = state[6];
    uint32_t h = state[7];

    for (size_t i = 0; i < kRoundConstants.size(); ++i) {
        const uint32_t s1 = rotate_right(e, 6u) ^ rotate_right(e, 11u) ^ rotate_right(e, 25u);
        const uint32_t choose = (e & f) ^ ((~e) & g);
        const uint32_t temp1 = h + s1 + choose + kRoundConstants[i] + words[i];
        const uint32_t s0 = rotate_right(a, 2u) ^ rotate_right(a, 13u) ^ rotate_right(a, 22u);
        const uint32_t majority = (a & b) ^ (a & c) ^ (b & c);
        const uint32_t temp2 = s0 + majority;

        h = g;
        g = f;
        f = e;
        e = d + temp1;
        d = c;
        c = b;
        b = a;
        a = temp1 + temp2;
    }

    state[0] += a;
    state[1] += b;
    state[2] += c;
    state[3] += d;
    state[4] += e;
    state[5] += f;
    state[6] += g;
    state[7] += h;
}

} // namespace

std::string sha256_file(const std::string & path) {
    std::ifstream input(path, std::ios::binary);
    if (!input) {
        throw std::runtime_error("unable to open model for SHA-256: " + path);
    }

    std::array<uint32_t, 8> state = kInitialState;
    std::array<uint8_t, 64> block{};
    uint64_t total_bytes = 0;

    while (input) {
        input.read(reinterpret_cast<char *>(block.data()), static_cast<std::streamsize>(block.size()));
        const std::streamsize count = input.gcount();
        if (count > 0) {
            total_bytes += static_cast<uint64_t>(count);
            if (count == static_cast<std::streamsize>(block.size())) {
                process_block(block.data(), state);
            } else {
                const size_t used = static_cast<size_t>(count);
                block[used] = 0x80u;
                for (size_t i = used + 1; i < block.size(); ++i) {
                    block[i] = 0;
                }
                if (used >= 56) {
                    process_block(block.data(), state);
                    block.fill(0);
                }
                const uint64_t bit_length = total_bytes * 8u;
                for (size_t i = 0; i < 8; ++i) {
                    block[63 - i] = static_cast<uint8_t>(bit_length >> (i * 8));
                }
                process_block(block.data(), state);
            }
        }
    }

    if (!input.eof()) {
        throw std::runtime_error("failed while reading model for SHA-256: " + path);
    }

    if (total_bytes == 0 || (total_bytes % 64u) == 0u) {
        block.fill(0);
        block[0] = 0x80u;
        if (total_bytes % 64u >= 56u) {
            process_block(block.data(), state);
            block.fill(0);
        }
        const uint64_t bit_length = total_bytes * 8u;
        for (size_t i = 0; i < 8; ++i) {
            block[63 - i] = static_cast<uint8_t>(bit_length >> (i * 8));
        }
        process_block(block.data(), state);
    }

    std::ostringstream result;
    result << std::hex << std::setfill('0');
    for (const uint32_t word : state) {
        result << std::setw(8) << word;
    }
    return result.str();
}

std::string sha256_text(const std::string & text) {
    std::array<uint32_t, 8> state = kInitialState;
    const size_t full_blocks = text.size() / 64u;
    for (size_t i = 0; i < full_blocks; ++i) {
        process_block(
            reinterpret_cast<const uint8_t *>(text.data() + (i * 64u)),
            state);
    }

    std::array<uint8_t, 64> block{};
    const size_t remainder = text.size() % 64u;
    for (size_t i = 0; i < remainder; ++i) {
        block[i] = static_cast<uint8_t>(text[(full_blocks * 64u) + i]);
    }
    block[remainder] = 0x80u;
    if (remainder >= 56u) {
        process_block(block.data(), state);
        block.fill(0);
    }
    const uint64_t bit_length = static_cast<uint64_t>(text.size()) * 8u;
    for (size_t i = 0; i < 8; ++i) {
        block[63 - i] = static_cast<uint8_t>(bit_length >> (i * 8));
    }
    process_block(block.data(), state);

    std::ostringstream result;
    result << std::hex << std::setfill('0');
    for (const uint32_t word : state) {
        result << std::setw(8) << word;
    }
    return result.str();
}

} // namespace nexus
