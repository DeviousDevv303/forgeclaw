#pragma once

#include <cstddef>
#include <string>
#include <vector>

namespace nexus {

enum class RecordStatus {
    RawMaterial,
    LearningCandidate,
    VerifiedRecord,
    Rejected,
};

struct CorpusRecord {
    std::string id;
    RecordStatus status;
    std::string content;
    std::string content_sha256;
    std::string reason;
};

const char * record_status_name(RecordStatus status);

class CorpusStore {
public:
    explicit CorpusStore(std::string log_path);

    void load();
    std::string add_material(const std::string & content);
    bool create_candidate(const std::string & id);
    bool admit_candidate(const std::string & id, bool guardian_approved, const std::string & guardian_reason);
    bool reject_candidate(const std::string & id, const std::string & reason);

    CorpusRecord inspect(const std::string & id) const;
    std::vector<CorpusRecord> candidates() const;
    std::vector<CorpusRecord> search_verified(const std::string & query) const;
    bool verify_integrity(std::vector<std::string> * failures = nullptr) const;
    size_t size() const;

private:
    std::string log_path_;
    std::vector<CorpusRecord> records_;
    size_t next_id_ = 1;

    void append_event(const CorpusRecord & record) const;
    CorpusRecord & find_mutable(const std::string & id);
    const CorpusRecord & find(const std::string & id) const;
};

} // namespace nexus
