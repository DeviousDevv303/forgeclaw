#include "corpus_store.hpp"
#include "inference_runtime.hpp"
#include "local_protocol.hpp"

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <map>
#include <stdexcept>
#include <string>
#include <vector>

#include <sodium.h>

#include <fcntl.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

namespace {

struct Options {
    nexus::RuntimeConfig runtime;
    std::string socket_path = "/tmp/nexus.sock";
    std::string corpus_path = "/tmp/nexus-corpus.log";
};

// ─── CORPUS Admission Ed25519 Verification ───
// RFC 8032 test vector key (test mode only).
// Production deployments must populate trusted keys from a config file.
static const std::map<std::string, std::string> TRUSTED_ADMIT_KEYS = {
    {"rfc8032-test-vector", "d75a980182b10ab7d54bfed3c964073a0ee172f3daa62325af021a68f707511a"},
};

static std::vector<unsigned char> hex_to_bytes(const std::string & hex) {
    std::vector<unsigned char> out;
    if (hex.size() % 2 != 0) return out;
    out.reserve(hex.size() / 2);
    for (size_t i = 0; i < hex.size(); i += 2) {
        unsigned int byte = 0;
        if (sscanf(hex.c_str() + i, "%2x", &byte) != 1) return std::vector<unsigned char>();
        out.push_back(static_cast<unsigned char>(byte));
    }
    return out;
}

// Verify Ed25519 signature for CORPUS_ADMIT authorization.
// Returns true on success, false with error reason on failure.
static bool verify_admit_authorization(
    const std::string & candidate_id,
    const std::string & key_id,
    const std::string & issued_at,
    const std::string & expires_at,
    const std::string & signature_hex,
    std::string & error_out) {

    auto key_it = TRUSTED_ADMIT_KEYS.find(key_id);
    if (key_it == TRUSTED_ADMIT_KEYS.end()) {
        error_out = "untrusted_key";
        return false;
    }

    // TODO: Validate issued_at < now < expires_at (ISO 8601 parsing)
    // For now, require non-empty timestamps
    if (issued_at.empty() || expires_at.empty() || expires_at <= issued_at) {
        error_out = "invalid_authorization_window";
        return false;
    }

    std::vector<unsigned char> pubkey = hex_to_bytes(key_it->second);
    std::vector<unsigned char> signature = hex_to_bytes(signature_hex);
    if (pubkey.size() != 32 || signature.size() != 64) {
        error_out = "invalid_signature_encoding";
        return false;
    }

    // Construct canonical payload (must match TS authorizationPayload())
    // For now, sign candidate_id + key_id + timestamps.
    // Full JCS canonicalization TODO: implement JSON canonicalization
    std::string message = candidate_id + "|" + key_id + "|" + issued_at + "|" + expires_at;

    if (sodium_init() < 0) {
        error_out = "sodium_init_failed";
        return false;
    }

    if (crypto_sign_verify_detached(
            signature.data(),
            reinterpret_cast<const unsigned char*>(message.c_str()),
            message.size(),
            pubkey.data()) != 0) {
        error_out = "signature_invalid";
        return false;
    }

    return true;
}

void usage(const char * program) {
    std::cerr << "Usage: " << program << " --model PATH --sha256 HEX [--socket PATH] [--corpus PATH] [--ctx N] [--threads N] [--n-predict N]\n";
}

int32_t parse_i32(const char * value, const char * option) {
    char * end = nullptr;
    const long parsed = std::strtol(value, &end, 10);
    if (end == value || *end != '\0' || parsed < 1 || parsed > INT32_MAX) {
        throw std::runtime_error(std::string("invalid value for ") + option);
    }
    return static_cast<int32_t>(parsed);
}

uint32_t parse_u32(const char * value, const char * option) {
    char * end = nullptr;
    const unsigned long parsed = std::strtoul(value, &end, 10);
    if (end == value || *end != '\0' || parsed < 1 || parsed > UINT32_MAX) {
        throw std::runtime_error(std::string("invalid value for ") + option);
    }
    return static_cast<uint32_t>(parsed);
}

Options parse_options(int argc, char ** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        if (argument == "--model" && i + 1 < argc) options.runtime.model_path = argv[++i];
        else if (argument == "--sha256" && i + 1 < argc) options.runtime.expected_sha256 = argv[++i];
        else if (argument == "--socket" && i + 1 < argc) options.socket_path = argv[++i];
        else if (argument == "--corpus" && i + 1 < argc) options.corpus_path = argv[++i];
        else if (argument == "--ctx" && i + 1 < argc) options.runtime.n_ctx = parse_u32(argv[++i], "--ctx");
        else if (argument == "--threads" && i + 1 < argc) options.runtime.n_threads = parse_i32(argv[++i], "--threads");
        else if (argument == "--n-predict" && i + 1 < argc) options.runtime.n_predict = parse_i32(argv[++i], "--n-predict");
        else throw std::runtime_error("unknown or incomplete option: " + argument);
    }
    if (options.runtime.model_path.empty() || options.runtime.expected_sha256.empty()) {
        throw std::runtime_error("--model and --sha256 are required");
    }
    return options;
}

std::vector<std::string> split_tabs(const std::string & line) {
    std::vector<std::string> fields;
    size_t start = 0;
    while (true) {
        const size_t end = line.find('\t', start);
        fields.push_back(line.substr(start, end == std::string::npos ? end : end - start));
        if (end == std::string::npos) break;
        start = end + 1u;
    }
    return fields;
}

std::string ok(const std::string & payload) {
    return "OK\t" + payload + "\nEND\n";
}

std::string error_response(const std::string & message) {
    return "ERR\t" + nexus::base64_encode(message) + "\nEND\n";
}

std::string record_line(const nexus::CorpusRecord & record) {
    return record.id + "\t" + nexus::record_status_name(record.status) + "\t"
        + record.content_sha256 + "\t" + nexus::base64_encode(record.content) + "\t"
        + nexus::base64_encode(record.reason) + "\n";
}

std::string handle_request(const std::string & request, nexus::InferenceRuntime & runtime, nexus::CorpusStore & corpus) {
    const std::vector<std::string> fields = split_tabs(request);
    if (fields.empty()) return error_response("empty request");

    if (fields[0] == "STATUS" || fields[0] == "RUNTIME") {
        const nexus::RuntimeStatus status = runtime.status();
        return ok("STATUS\tinitialized=" + std::to_string(status.initialized ? 1 : 0)
            + "\tmodel=" + status.model_path
            + "\tsha256=" + status.model_sha256
            + "\tlibllama=" + status.libllama_version
            + "\tctx=" + std::to_string(status.n_ctx)
            + "\tthreads=" + std::to_string(status.n_threads)
            + "\toffline=1\tollama=0\n");
    }
    if (fields[0] == "CHAT" && fields.size() == 2u) {
        const std::string response = runtime.chat(nexus::base64_decode(fields[1]));
        return ok("CHAT\t" + nexus::base64_encode(response) + "\n");
    }
    if (fields[0] == "CORPUS_ADD" && fields.size() == 2u) {
        return ok("CORPUS_ADD\tid=" + corpus.add_material(nexus::base64_decode(fields[1])) + "\n");
    }
    if (fields[0] == "CORPUS_CANDIDATE" && fields.size() == 2u) {
        return ok("CORPUS_CANDIDATE\tid=" + fields[1] + "\tchanged=" + std::to_string(corpus.create_candidate(fields[1]) ? 1 : 0) + "\n");
    }
    // CORPUS_ADMIT requires Ed25519 signature (8 fields).
    // Old 4-field unsigned protocol is rejected.
    if (fields[0] == "CORPUS_ADMIT") {
        if (fields.size() == 4u) {
            return ok("CORPUS_ADMIT\terror=unsigned_protocol_rejected\n");
        }
        if (fields.size() != 8u) {
            return ok("CORPUS_ADMIT\terror=malformed_protocol\n");
        }
        const std::string & id = fields[1];
        const bool guardian_approved = fields[2] == "1";
        const std::string reason = nexus::base64_decode(fields[3]);
        const std::string & key_id = fields[4];
        const std::string & issued_at = fields[5];
        const std::string & expires_at = fields[6];
        const std::string & signature_hex = fields[7];

        // Verify Ed25519 signature before admitting
        std::string verify_error;
        if (!verify_admit_authorization(id, key_id, issued_at, expires_at, signature_hex, verify_error)) {
            return ok("CORPUS_ADMIT\tid=" + id + "\terror=" + verify_error + "\n");
        }

        const bool admitted = corpus.admit_candidate(id, guardian_approved, reason);
        return ok("CORPUS_ADMIT\tid=" + id + "\tadmitted=" + std::to_string(admitted ? 1 : 0) + "\n");
    }
    if (fields[0] == "CORPUS_REJECT" && fields.size() == 3u) {
        const bool rejected = corpus.reject_candidate(fields[1], nexus::base64_decode(fields[2]));
        return ok("CORPUS_REJECT\tid=" + fields[1] + "\trejected=" + std::to_string(rejected ? 1 : 0) + "\n");
    }
    if (fields[0] == "CORPUS_INSPECT" && fields.size() == 2u) {
        return ok("CORPUS_INSPECT\n" + record_line(corpus.inspect(fields[1])));
    }
    if (fields[0] == "CORPUS_SEARCH" && fields.size() == 2u) {
        const std::vector<nexus::CorpusRecord> records = corpus.search_verified(nexus::base64_decode(fields[1]));
        std::string response = "CORPUS_SEARCH\tcount=" + std::to_string(records.size()) + "\n";
        for (const nexus::CorpusRecord & record : records) response += record_line(record);
        return ok(response);
    }
    if (fields[0] == "CANDIDATES") {
        const std::vector<nexus::CorpusRecord> records = corpus.candidates();
        std::string response = "CANDIDATES\tcount=" + std::to_string(records.size()) + "\n";
        for (const nexus::CorpusRecord & record : records) response += record_line(record);
        return ok(response);
    }
    if (fields[0] == "VERIFY") {
        std::vector<std::string> failures;
        const bool passed = corpus.verify_integrity(&failures);
        std::string response = "VERIFY\tpassed=" + std::to_string(passed ? 1 : 0) + "\tfailures=" + std::to_string(failures.size()) + "\n";
        for (const std::string & id : failures) response += id + "\n";
        return ok(response);
    }
    return error_response("unsupported or malformed request");
}

int create_server_socket(const std::string & path) {
    const std::filesystem::path socket_path(path);
    if (!socket_path.parent_path().empty()) {
        std::filesystem::create_directories(socket_path.parent_path());
        chmod(socket_path.parent_path().c_str(), 0700);
    }
    unlink(path.c_str());
    const int fd = socket(AF_UNIX, SOCK_STREAM, 0);
    if (fd < 0) throw std::runtime_error("unable to create NEXUS socket");
    sockaddr_un address{};
    address.sun_family = AF_UNIX;
    if (path.size() >= sizeof(address.sun_path)) throw std::runtime_error("NEXUS socket path is too long");
    std::strncpy(address.sun_path, path.c_str(), sizeof(address.sun_path) - 1u);
    if (bind(fd, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) < 0) {
        close(fd);
        throw std::runtime_error(std::string("unable to bind NEXUS socket: ") + std::strerror(errno));
    }
    chmod(path.c_str(), 0600);
    if (listen(fd, 8) < 0) {
        close(fd);
        throw std::runtime_error("unable to listen on NEXUS socket");
    }
    return fd;
}

} // namespace

int main(int argc, char ** argv) {
    try {
        const Options options = parse_options(argc, argv);
        nexus::InferenceRuntime runtime(options.runtime);
        runtime.initialize();
        nexus::CorpusStore corpus(options.corpus_path);
        corpus.load();
        const int server = create_server_socket(options.socket_path);
        std::cout << "NEXUS_READY socket=" << options.socket_path << " corpus=" << options.corpus_path << '\n';
        std::cout.flush();

        while (true) {
            const int client = accept(server, nullptr, nullptr);
            if (client < 0) {
                if (errno == EINTR) continue;
                throw std::runtime_error("NEXUS accept failed");
            }
            try {
                const std::string request = nexus::read_line(client);
                nexus::write_all(client, handle_request(request, runtime, corpus));
            } catch (const std::exception & exception) {
                try { nexus::write_all(client, error_response(exception.what())); } catch (...) {}
            }
            close(client);
        }
    } catch (const std::exception & exception) {
        std::cerr << "NEXUS_DAEMON_FAILED " << exception.what() << '\n';
        return 1;
    }
}
