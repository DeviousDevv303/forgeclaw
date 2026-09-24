#include "local_protocol.hpp"

#include <cerrno>
#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <stdexcept>
#include <string>

#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/socket.h>
#include <unistd.h>

namespace {

struct Options {
    std::string socket_path = "/tmp/nexus.sock";
    uint16_t port = 8787;
};

uint16_t parse_port(const char * value) {
    char * end = nullptr;
    const unsigned long parsed = std::strtoul(value, &end, 10);
    if (end == value || *end != '\0' || parsed == 0 || parsed > 65535u) {
        throw std::runtime_error("invalid --port");
    }
    return static_cast<uint16_t>(parsed);
}

Options parse_options(int argc, char ** argv) {
    Options options;
    for (int i = 1; i < argc; ++i) {
        const std::string argument = argv[i];
        if (argument == "--socket" && i + 1 < argc) options.socket_path = argv[++i];
        else if (argument == "--port" && i + 1 < argc) options.port = parse_port(argv[++i]);
        else throw std::runtime_error("unknown or incomplete option: " + argument);
    }
    return options;
}

int create_server(uint16_t port) {
    const int fd = socket(AF_INET, SOCK_STREAM, 0);
    if (fd < 0) throw std::runtime_error("unable to create HTTP bridge socket");
    int reuse = 1;
    setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &reuse, sizeof(reuse));
    sockaddr_in address{};
    address.sin_family = AF_INET;
    address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
    address.sin_port = htons(port);
    if (bind(fd, reinterpret_cast<const sockaddr *>(&address), sizeof(address)) < 0) {
        close(fd);
        throw std::runtime_error(std::string("unable to bind HTTP bridge: ") + std::strerror(errno));
    }
    if (listen(fd, 8) < 0) {
        close(fd);
        throw std::runtime_error("unable to listen on HTTP bridge");
    }
    return fd;
}

std::string read_request_body(int fd) {
    std::string request;
    char buffer[4096];
    size_t body_start = std::string::npos;
    size_t content_length = 0;
    while (request.size() < 1024u * 1024u) {
        const ssize_t count = recv(fd, buffer, sizeof(buffer), 0);
        if (count <= 0) break;
        request.append(buffer, static_cast<size_t>(count));
        const size_t separator = request.find("\r\n\r\n");
        if (separator != std::string::npos) {
            body_start = separator + 4u;
            const size_t header = request.find("Content-Length:");
            if (header != std::string::npos) {
                const size_t value_start = header + 15u;
                const size_t value_end = request.find('\r', value_start);
                content_length = static_cast<size_t>(std::stoul(request.substr(value_start, value_end - value_start)));
            }
            if (request.size() >= body_start + content_length) break;
        }
    }
    if (body_start == std::string::npos || request.size() < body_start + content_length) {
        throw std::runtime_error("incomplete HTTP bridge request");
    }
    return request.substr(body_start, content_length);
}

void respond(int fd, const std::string & body, const char * status = "200 OK") {
    const std::string response = std::string("HTTP/1.1 ") + status + "\r\n"
        + "Content-Type: text/plain; charset=utf-8\r\n"
        + "Access-Control-Allow-Origin: *\r\n"
        + "Access-Control-Allow-Methods: POST, OPTIONS\r\n"
        + "Access-Control-Allow-Headers: Content-Type\r\n"
        + "Content-Length: " + std::to_string(body.size()) + "\r\n"
        + "Connection: close\r\n\r\n" + body;
    nexus::write_all(fd, response);
}

} // namespace

int main(int argc, char ** argv) {
    try {
        const Options options = parse_options(argc, argv);
        const int server = create_server(options.port);
        std::cout << "NEXUS_HTTP_BRIDGE_READY address=127.0.0.1:" << options.port
                  << " socket=" << options.socket_path << '\n';
        std::cout.flush();
        while (true) {
            const int client = accept(server, nullptr, nullptr);
            if (client < 0) {
                if (errno == EINTR) continue;
                throw std::runtime_error("HTTP bridge accept failed");
            }
            try {
                const std::string body = read_request_body(client);
                const int socket = nexus::connect_unix_socket(options.socket_path);
                nexus::write_all(socket, body + (body.empty() || body.back() == '\n' ? "" : "\n"));
                std::string forwarded;
                while (true) {
                    const std::string line = nexus::read_line(socket);
                    if (line.empty()) break;
                    forwarded += line + '\n';
                    if (line == "END") break;
                }
                close(socket);
                respond(client, forwarded);
            } catch (const std::exception & exception) {
                try { respond(client, exception.what(), "400 Bad Request"); } catch (...) {}
            }
            close(client);
        }
    } catch (const std::exception & exception) {
        std::cerr << "NEXUS_HTTP_BRIDGE_FAILED " << exception.what() << '\n';
        return 1;
    }
}
