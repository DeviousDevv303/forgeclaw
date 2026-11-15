#include "llama.h"
#include "sha256.hpp"

#include <cstdint>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <locale>
#include <stdexcept>
#include <string>
#include <vector>

namespace {

struct Options {
    std::string model_path;
    std::string expected_sha256;
    std::string prompt;
    int32_t n_predict = 32;
    uint32_t n_ctx = 4096;
    int32_t n_threads = 2;
};

void print_usage(const char * program) {
    std::cerr
        << "Usage: " << program << " --model PATH --sha256 HEX [--prompt TEXT] [--n-predict N] [--ctx N] [--threads N]\n"
        << "       " << program << " --version\n";
}

bool is_sha256(const std::string & value) {
    if (value.size() != 64) {
        return false;
    }
    for (const char character : value) {
        const bool digit = character >= '0' && character <= '9';
        const bool lower = character >= 'a' && character <= 'f';
        const bool upper = character >= 'A' && character <= 'F';
        if (!digit && !lower && !upper) {
            return false;
        }
    }
    return true;
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
        if (argument == "--model" && i + 1 < argc) {
            options.model_path = argv[++i];
        } else if (argument == "--sha256" && i + 1 < argc) {
            options.expected_sha256 = argv[++i];
        } else if (argument == "--prompt" && i + 1 < argc) {
            options.prompt = argv[++i];
        } else if (argument == "--n-predict" && i + 1 < argc) {
            options.n_predict = parse_i32(argv[++i], "--n-predict");
        } else if (argument == "--ctx" && i + 1 < argc) {
            options.n_ctx = parse_u32(argv[++i], "--ctx");
        } else if (argument == "--threads" && i + 1 < argc) {
            options.n_threads = parse_i32(argv[++i], "--threads");
        } else if (argument == "--version") {
            std::cout << "nexus-runtime 0.1.0\nlibllama " << llama_version() << "\n";
            std::exit(0);
        } else {
            throw std::runtime_error("unknown or incomplete option: " + argument);
        }
    }
    if (options.model_path.empty()) {
        throw std::runtime_error("--model is required");
    }
    if (!is_sha256(options.expected_sha256)) {
        throw std::runtime_error("--sha256 must be a 64-character hexadecimal digest");
    }
    if (options.prompt.empty()) {
        options.prompt = "Reply with one concise sentence confirming local NEXUS inference.";
    }
    return options;
}

std::string format_chat_prompt(const llama_model * model, const std::string & user_prompt) {
    const char * template_name = llama_model_chat_template(model, nullptr);
    if (template_name == nullptr) {
        return user_prompt;
    }

    const llama_chat_message message = {"user", user_prompt.c_str()};
    std::vector<char> formatted(user_prompt.size() * 2u + 256u);
    int32_t length = llama_chat_apply_template(
        template_name,
        &message,
        1,
        true,
        formatted.data(),
        static_cast<int32_t>(formatted.size()));
    if (length < 0) {
        throw std::runtime_error("failed to apply model chat template");
    }
    if (static_cast<size_t>(length) >= formatted.size()) {
        formatted.resize(static_cast<size_t>(length) + 1u);
        length = llama_chat_apply_template(
            template_name,
            &message,
            1,
            true,
            formatted.data(),
            static_cast<int32_t>(formatted.size()));
        if (length < 0) {
            throw std::runtime_error("failed to apply model chat template after resize");
        }
    }
    return std::string(formatted.data(), static_cast<size_t>(length));
}

int run_inference(const Options & options) {
    const std::string actual_sha256 = nexus::sha256_file(options.model_path);
    if (actual_sha256 != options.expected_sha256) {
        std::cerr << "NEXUS_MODEL_INTEGRITY_FAILED expected=" << options.expected_sha256
                  << " actual=" << actual_sha256 << '\n';
        return 2;
    }
    std::cout << "NEXUS_MODEL_VERIFIED sha256=" << actual_sha256 << '\n';

    ggml_backend_load_all();

    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    llama_model * model = llama_model_load_from_file(options.model_path.c_str(), model_params);
    if (model == nullptr) {
        std::cerr << "NEXUS_MODEL_LOAD_FAILED path=" << options.model_path << '\n';
        return 2;
    }

    const llama_vocab * vocab = llama_model_get_vocab(model);
    const std::string inference_prompt = format_chat_prompt(model, options.prompt);
    const int32_t required_tokens = -llama_tokenize(
        vocab,
        inference_prompt.c_str(),
        static_cast<int32_t>(inference_prompt.size()),
        nullptr,
        0,
        true,
        true);
    if (required_tokens <= 0) {
        std::cerr << "NEXUS_TOKENIZE_FAILED\n";
        llama_model_free(model);
        return 3;
    }

    std::vector<llama_token> prompt_tokens(static_cast<size_t>(required_tokens));
    if (llama_tokenize(
            vocab,
            inference_prompt.c_str(),
            static_cast<int32_t>(inference_prompt.size()),
            prompt_tokens.data(),
            required_tokens,
            true,
            true) < 0) {
        std::cerr << "NEXUS_TOKENIZE_FAILED\n";
        llama_model_free(model);
        return 3;
    }

    if (static_cast<uint32_t>(required_tokens) + static_cast<uint32_t>(options.n_predict) >= options.n_ctx) {
        std::cerr << "NEXUS_CONTEXT_LIMIT prompt_tokens=" << required_tokens
                  << " n_predict=" << options.n_predict
                  << " n_ctx=" << options.n_ctx << '\n';
        llama_model_free(model);
        return 4;
    }

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = options.n_ctx;
    context_params.n_batch = options.n_ctx;
    context_params.n_threads = options.n_threads;
    context_params.n_threads_batch = options.n_threads;
    context_params.no_perf = true;

    llama_context * context = llama_init_from_model(model, context_params);
    if (context == nullptr) {
        std::cerr << "NEXUS_CONTEXT_INIT_FAILED\n";
        llama_model_free(model);
        return 5;
    }

    llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
    sampler_params.no_perf = true;
    llama_sampler * sampler = llama_sampler_chain_init(sampler_params);
    if (sampler == nullptr) {
        std::cerr << "NEXUS_SAMPLER_INIT_FAILED\n";
        llama_free(context);
        llama_model_free(model);
        return 6;
    }
    llama_sampler_chain_add(sampler, llama_sampler_init_greedy());

    llama_batch batch = llama_batch_get_one(prompt_tokens.data(), static_cast<int32_t>(prompt_tokens.size()));
    if (llama_decode(context, batch) != 0) {
        std::cerr << "NEXUS_DECODE_FAILED stage=prompt\n";
        llama_sampler_free(sampler);
        llama_free(context);
        llama_model_free(model);
        return 7;
    }

    std::cout << "NEXUS_RESPONSE_BEGIN\n";
    for (int32_t generated = 0; generated < options.n_predict; ++generated) {
        llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(vocab, token)) {
            break;
        }

        char piece[256];
        const int32_t piece_length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (piece_length < 0) {
            std::cerr << "NEXUS_TOKEN_RENDER_FAILED\n";
            llama_sampler_free(sampler);
            llama_free(context);
            llama_model_free(model);
            return 8;
        }
        std::cout.write(piece, piece_length);
        std::cout.flush();

        batch = llama_batch_get_one(&token, 1);
        if (llama_decode(context, batch) != 0) {
            std::cerr << "NEXUS_DECODE_FAILED stage=generation\n";
            llama_sampler_free(sampler);
            llama_free(context);
            llama_model_free(model);
            return 7;
        }
    }
    std::cout << "\nNEXUS_RESPONSE_END\n";

    llama_sampler_free(sampler);
    llama_free(context);
    llama_model_free(model);
    return 0;
}

} // namespace

int main(int argc, char ** argv) {
    std::setlocale(LC_NUMERIC, "C");
    try {
        const Options options = parse_options(argc, argv);
        return run_inference(options);
    } catch (const std::exception & error) {
        std::cerr << "NEXUS_ARGUMENT_ERROR " << error.what() << '\n';
        print_usage(argv[0]);
        return 1;
    }
}
