#include "corpus_store.hpp"
#include "inference_runtime.hpp"
#include "local_protocol.hpp"

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

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
    if (fields[0] == "CORPUS_ADMIT" && fields.size() == 4u) {
        const bool guardian_approved = fields[2] == "1";
        const bool admitted = corpus.admit_candidate(fields[1], guardian_approved, nexus::base64_decode(fields[3]));
        return ok("CORPUS_ADMIT\tid=" + fields[1] + "\tadmitted=" + std::to_string(admitted ? 1 : 0) + "\n");
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
