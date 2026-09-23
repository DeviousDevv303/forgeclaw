#include "local_protocol.hpp"

#include <cstdlib>
#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>

#include <unistd.h>

namespace {

std::string socket_path(int argc, char ** argv, int & index) {
    const char * environment = std::getenv("NEXUS_SOCKET");
    std::string path = environment == nullptr ? "/tmp/nexus.sock" : environment;
    if (index + 1 < argc && std::string(argv[index]) == "--socket") {
        path = argv[index + 1];
        index += 2;
    }
    return path;
}

std::string join_arguments(int argc, char ** argv, int start) {
    std::string result;
    for (int i = start; i < argc; ++i) {
        if (!result.empty()) result += ' ';
        result += argv[i];
    }
    return result;
}

void print_usage(const char * program) {
    std::cerr << "Usage: " << program << " [--socket PATH] status|runtime|chat TEXT|corpus add TEXT|corpus search TEXT|corpus inspect ID|candidates|verify\n";
}

std::string render_record_line(const std::string & line) {
    if (line.rfind("rec-", 0u) != 0u) {
        return line;
    }
    std::vector<std::string> fields;
    size_t start = 0;
    while (true) {
        const size_t end = line.find('\t', start);
        fields.push_back(line.substr(start, end == std::string::npos ? end : end - start));
        if (end == std::string::npos) break;
        start = end + 1u;
    }
    if (fields.size() != 5u) {
        return line;
    }
    return fields[0] + "\t" + fields[1] + "\tsha256=" + fields[2]
        + "\tcontent=" + nexus::base64_decode(fields[3])
        + "\treason=" + nexus::base64_decode(fields[4]);
}

} // namespace

int main(int argc, char ** argv) {
    try {
        if (argc < 2) {
            print_usage(argv[0]);
            return 1;
        }
        int index = 1;
        const std::string path = socket_path(argc, argv, index);
        if (index >= argc) throw std::runtime_error("command is required");
        const std::string command = argv[index++];

        std::string payload;
        if (command == "status") payload = "STATUS";
        else if (command == "runtime") payload = "RUNTIME";
        else if (command == "chat") payload = "CHAT\t" + nexus::base64_encode(join_arguments(argc, argv, index));
        else if (command == "candidates") payload = "CANDIDATES";
        else if (command == "verify") payload = "VERIFY";
    else if (command == "corpus" && index < argc) {
        const std::string subcommand = argv[index++];
        if (subcommand == "add") payload = "CORPUS_ADD\t" + nexus::base64_encode(join_arguments(argc, argv, index));
        else if (subcommand == "search") payload = "CORPUS_SEARCH\t" + nexus::base64_encode(join_arguments(argc, argv, index));
        else if (subcommand == "inspect" && index < argc) payload = "CORPUS_INSPECT\t" + std::string(argv[index]);
        else if (subcommand == "candidate" && index < argc) payload = "CORPUS_CANDIDATE\t" + std::string(argv[index]);
        else if ((subcommand == "admit" || subcommand == "reject") && index < argc) {
            const std::string id = argv[index++];
            bool guardian_approved = subcommand == "admit";
            if (guardian_approved && index < argc && std::string(argv[index]) == "--deny") {
                guardian_approved = false;
                ++index;
            }
            const std::string reason = join_arguments(argc, argv, index);
            if (subcommand == "admit") {
                payload = "CORPUS_ADMIT\t" + id + "\t" + (guardian_approved ? "1" : "0") + "\t"
                    + nexus::base64_encode(reason.empty() ? "Guardian approved by owner" : reason);
            } else {
                payload = "CORPUS_REJECT\t" + id + "\t"
                    + nexus::base64_encode(reason.empty() ? "rejected by owner" : reason);
            }
        }
        else throw std::runtime_error("unsupported corpus command");
        } else {
            throw std::runtime_error("unsupported command");
        }

        const int fd = nexus::connect_unix_socket(path);
        nexus::write_all(fd, payload + "\n");
        while (true) {
            const std::string line = nexus::read_line(fd);
            if (line == "END" || line.empty()) break;
            if (line.rfind("ERR\t", 0) == 0u) {
                std::cerr << nexus::base64_decode(line.substr(4)) << '\n';
                close(fd);
                return 2;
            }
            if (line.rfind("OK\t", 0) == 0u) {
                const std::string body = line.substr(3);
                if (body.rfind("CHAT\t", 0) == 0u) {
                    std::cout << nexus::base64_decode(body.substr(5)) << '\n';
                } else {
                    std::cout << body << '\n';
                }
            } else {
                std::cout << render_record_line(line) << '\n';
            }
        }
        close(fd);
        return 0;
    } catch (const std::exception & exception) {
        std::cerr << "NEXUS_CLI_FAILED " << exception.what() << '\n';
        return 1;
    }
}
