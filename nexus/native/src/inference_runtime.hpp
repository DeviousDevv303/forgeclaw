#pragma once

#include <cstdint>
#include <string>

struct llama_model;

namespace nexus {

struct RuntimeConfig {
    std::string model_path;
    std::string expected_sha256;
    uint32_t n_ctx = 4096;
    int32_t n_threads = 2;
    int32_t n_predict = 32;
};

struct RuntimeStatus {
    bool initialized = false;
    std::string model_path;
    std::string model_sha256;
    std::string libllama_version;
    uint32_t n_ctx = 0;
    int32_t n_threads = 0;
};

class InferenceRuntime {
public:
    explicit InferenceRuntime(RuntimeConfig config);
    ~InferenceRuntime();

    InferenceRuntime(const InferenceRuntime &) = delete;
    InferenceRuntime & operator=(const InferenceRuntime &) = delete;

    void initialize();
    std::string chat(const std::string & user_prompt, int32_t n_predict = -1);
    RuntimeStatus status() const;

private:
    RuntimeConfig config_;
    RuntimeStatus status_;
    llama_model * model_ = nullptr;
};

} // namespace nexus
