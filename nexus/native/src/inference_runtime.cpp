#include "inference_runtime.hpp"

#include "sha256.hpp"

#include "llama.h"

#include <stdexcept>
#include <string>
#include <utility>
#include <vector>

namespace nexus {
namespace {

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

} // namespace

InferenceRuntime::InferenceRuntime(RuntimeConfig config) : config_(std::move(config)) {}

InferenceRuntime::~InferenceRuntime() {
    if (model_ != nullptr) {
        llama_model_free(model_);
    }
}

void InferenceRuntime::initialize() {
    const std::string actual_sha256 = sha256_file(config_.model_path);
    if (actual_sha256 != config_.expected_sha256) {
        throw std::runtime_error(
            "NEXUS_MODEL_INTEGRITY_FAILED expected=" + config_.expected_sha256
            + " actual=" + actual_sha256);
    }

    ggml_backend_load_all();
    llama_model_params model_params = llama_model_default_params();
    model_params.n_gpu_layers = 0;
    model_ = llama_model_load_from_file(config_.model_path.c_str(), model_params);
    if (model_ == nullptr) {
        throw std::runtime_error("NEXUS_MODEL_LOAD_FAILED path=" + config_.model_path);
    }

    status_.initialized = true;
    status_.model_path = config_.model_path;
    status_.model_sha256 = actual_sha256;
    status_.libllama_version = llama_version();
    status_.n_ctx = config_.n_ctx;
    status_.n_threads = config_.n_threads;
}

std::string InferenceRuntime::chat(const std::string & user_prompt, int32_t n_predict) {
    if (!status_.initialized || model_ == nullptr) {
        throw std::runtime_error("NEXUS_RUNTIME_NOT_INITIALIZED");
    }
    const int32_t generation_limit = n_predict < 0 ? config_.n_predict : n_predict;
    if (generation_limit < 1) {
        throw std::runtime_error("NEXUS_INVALID_GENERATION_LIMIT");
    }

    const llama_vocab * vocab = llama_model_get_vocab(model_);
    const std::string inference_prompt = format_chat_prompt(model_, user_prompt);
    const int32_t required_tokens = -llama_tokenize(
        vocab,
        inference_prompt.c_str(),
        static_cast<int32_t>(inference_prompt.size()),
        nullptr,
        0,
        true,
        true);
    if (required_tokens <= 0) {
        throw std::runtime_error("NEXUS_TOKENIZE_FAILED");
    }
    if (static_cast<uint32_t>(required_tokens) + static_cast<uint32_t>(generation_limit) >= config_.n_ctx) {
        throw std::runtime_error("NEXUS_CONTEXT_LIMIT");
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
        throw std::runtime_error("NEXUS_TOKENIZE_FAILED");
    }

    llama_context_params context_params = llama_context_default_params();
    context_params.n_ctx = config_.n_ctx;
    context_params.n_batch = config_.n_ctx;
    context_params.n_threads = config_.n_threads;
    context_params.n_threads_batch = config_.n_threads;
    context_params.no_perf = true;
    llama_context * context = llama_init_from_model(model_, context_params);
    if (context == nullptr) {
        throw std::runtime_error("NEXUS_CONTEXT_INIT_FAILED");
    }

    llama_sampler_chain_params sampler_params = llama_sampler_chain_default_params();
    sampler_params.no_perf = true;
    llama_sampler * sampler = llama_sampler_chain_init(sampler_params);
    if (sampler == nullptr) {
        llama_free(context);
        throw std::runtime_error("NEXUS_SAMPLER_INIT_FAILED");
    }
    llama_sampler_chain_add(sampler, llama_sampler_init_greedy());

    llama_batch batch = llama_batch_get_one(prompt_tokens.data(), static_cast<int32_t>(prompt_tokens.size()));
    if (llama_decode(context, batch) != 0) {
        llama_sampler_free(sampler);
        llama_free(context);
        throw std::runtime_error("NEXUS_DECODE_FAILED stage=prompt");
    }

    std::string response;
    for (int32_t generated = 0; generated < generation_limit; ++generated) {
        llama_token token = llama_sampler_sample(sampler, context, -1);
        if (llama_vocab_is_eog(vocab, token)) {
            break;
        }
        char piece[256];
        const int32_t piece_length = llama_token_to_piece(vocab, token, piece, sizeof(piece), 0, true);
        if (piece_length < 0) {
            llama_sampler_free(sampler);
            llama_free(context);
            throw std::runtime_error("NEXUS_TOKEN_RENDER_FAILED");
        }
        response.append(piece, static_cast<size_t>(piece_length));
        batch = llama_batch_get_one(&token, 1);
        if (llama_decode(context, batch) != 0) {
            llama_sampler_free(sampler);
            llama_free(context);
            throw std::runtime_error("NEXUS_DECODE_FAILED stage=generation");
        }
    }

    llama_sampler_free(sampler);
    llama_free(context);
    return response;
}

RuntimeStatus InferenceRuntime::status() const {
    return status_;
}

} // namespace nexus
