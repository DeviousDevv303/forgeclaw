#include "corpus_store.hpp"

#include "sha256.hpp"

#include <algorithm>
#include <cctype>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
#include <utility>

namespace nexus {
namespace {

std::string hex_encode(const std::string & value) {
    static constexpr char digits[] = "0123456789abcdef";
    std::string encoded;
    encoded.reserve(value.size() * 2u);
    for (const unsigned char byte : value) {
        encoded.push_back(digits[(byte >> 4u) & 0x0fu]);
        encoded.push_back(digits[byte & 0x0fu]);
    }
    return encoded;
}

unsigned char hex_value(char character) {
    if (character >= '0' && character <= '9') {
        return static_cast<unsigned char>(character - '0');
    }
    if (character >= 'a' && character <= 'f') {
        return static_cast<unsigned char>(character - 'a' + 10);
    }
    if (character >= 'A' && character <= 'F') {
        return static_cast<unsigned char>(character - 'A' + 10);
    }
    throw std::runtime_error("invalid hexadecimal Corpus field");
}

std::string hex_decode(const std::string & encoded) {
    if ((encoded.size() % 2u) != 0u) {
        throw std::runtime_error("odd-length hexadecimal Corpus field");
    }
    std::string decoded;
    decoded.reserve(encoded.size() / 2u);
    for (size_t i = 0; i < encoded.size(); i += 2u) {
        decoded.push_back(static_cast<char>((hex_value(encoded[i]) << 4u) | hex_value(encoded[i + 1u])));
    }
    return decoded;
}

std::vector<std::string> split_fields(const std::string & line) {
    std::vector<std::string> fields;
    std::stringstream stream(line);
    std::string field;
    while (std::getline(stream, field, '\t')) {
        fields.push_back(field);
    }
    return fields;
}

RecordStatus parse_status(const std::string & value) {
    if (value == "raw") return RecordStatus::RawMaterial;
    if (value == "candidate") return RecordStatus::LearningCandidate;
    if (value == "verified") return RecordStatus::VerifiedRecord;
    if (value == "rejected") return RecordStatus::Rejected;
    throw std::runtime_error("invalid Corpus status: " + value);
}

} // namespace

const char * record_status_name(RecordStatus status) {
    switch (status) {
        case RecordStatus::RawMaterial: return "raw";
        case RecordStatus::LearningCandidate: return "candidate";
        case RecordStatus::VerifiedRecord: return "verified";
        case RecordStatus::Rejected: return "rejected";
    }
    return "unknown";
}

CorpusStore::CorpusStore(std::string log_path) : log_path_(std::move(log_path)) {}

void CorpusStore::load() {
    records_.clear();
    next_id_ = 1;
    std::ifstream input(log_path_);
    if (!input) {
        return;
    }

    std::string line;
    while (std::getline(input, line)) {
        if (line.empty()) {
            continue;
        }
        const std::vector<std::string> fields = split_fields(line);
        if (fields.size() != 5u) {
            throw std::runtime_error("malformed Corpus log record");
        }
        CorpusRecord record{
            fields[0],
            parse_status(fields[1]),
            hex_decode(fields[3]),
            fields[2],
            hex_decode(fields[4]),
        };
        const auto existing = std::find_if(records_.begin(), records_.end(), [&](const CorpusRecord & current) {
            return current.id == record.id;
        });
        if (existing == records_.end()) {
            records_.push_back(std::move(record));
        } else {
            *existing = std::move(record);
        }
        if (fields[0].rfind("rec-", 0) == 0u) {
            try {
                next_id_ = std::max(next_id_, static_cast<size_t>(std::stoull(fields[0].substr(4))) + 1u);
            } catch (...) {
                throw std::runtime_error("invalid Corpus record id");
            }
        }
    }
    if (!input.eof()) {
        throw std::runtime_error("failed reading Corpus log");
    }
}

void CorpusStore::append_event(const CorpusRecord & record) const {
    std::ofstream output(log_path_, std::ios::app);
    if (!output) {
        throw std::runtime_error("unable to open Corpus log for append: " + log_path_);
    }
    output << record.id << '\t'
           << record_status_name(record.status) << '\t'
           << record.content_sha256 << '\t'
           << hex_encode(record.content) << '\t'
           << hex_encode(record.reason) << '\n';
    if (!output) {
        throw std::runtime_error("failed writing Corpus log");
    }
}

std::string CorpusStore::add_material(const std::string & content) {
    if (content.empty()) {
        throw std::runtime_error("Corpus Material cannot be empty");
    }
    CorpusRecord record{
        "rec-" + std::to_string(next_id_++),
        RecordStatus::RawMaterial,
        content,
        sha256_text(content),
        "awaiting candidate validation",
    };
    append_event(record);
    records_.push_back(record);
    return record.id;
}

CorpusRecord & CorpusStore::find_mutable(const std::string & id) {
    const auto iterator = std::find_if(records_.begin(), records_.end(), [&](const CorpusRecord & record) {
        return record.id == id;
    });
    if (iterator == records_.end()) {
        throw std::runtime_error("Corpus record not found: " + id);
    }
    return *iterator;
}

const CorpusRecord & CorpusStore::find(const std::string & id) const {
    const auto iterator = std::find_if(records_.begin(), records_.end(), [&](const CorpusRecord & record) {
        return record.id == id;
    });
    if (iterator == records_.end()) {
        throw std::runtime_error("Corpus record not found: " + id);
    }
    return *iterator;
}

bool CorpusStore::create_candidate(const std::string & id) {
    CorpusRecord & record = find_mutable(id);
    if (record.status != RecordStatus::RawMaterial) {
        return false;
    }
    record.status = RecordStatus::LearningCandidate;
    record.reason = "candidate requires validation and Guardian approval";
    append_event(record);
    return true;
}

bool CorpusStore::admit_candidate(const std::string & id, bool guardian_approved, const std::string & guardian_reason) {
    CorpusRecord & record = find_mutable(id);
    if (record.status != RecordStatus::LearningCandidate) {
        return false;
    }
    const bool integrity_ok = record.content_sha256 == sha256_text(record.content);
    if (!integrity_ok || !guardian_approved) {
        record.status = RecordStatus::Rejected;
        record.reason = !integrity_ok ? "integrity verification failed" : guardian_reason;
        append_event(record);
        return false;
    }
    record.status = RecordStatus::VerifiedRecord;
    record.reason = guardian_reason;
    append_event(record);
    return true;
}

bool CorpusStore::reject_candidate(const std::string & id, const std::string & reason) {
    CorpusRecord & record = find_mutable(id);
    if (record.status != RecordStatus::LearningCandidate) {
        return false;
    }
    record.status = RecordStatus::Rejected;
    record.reason = reason.empty() ? "rejected by validation" : reason;
    append_event(record);
    return true;
}

CorpusRecord CorpusStore::inspect(const std::string & id) const {
    return find(id);
}

std::vector<CorpusRecord> CorpusStore::candidates() const {
    std::vector<CorpusRecord> result;
    for (const CorpusRecord & record : records_) {
        if (record.status == RecordStatus::LearningCandidate) {
            result.push_back(record);
        }
    }
    return result;
}

std::vector<CorpusRecord> CorpusStore::search_verified(const std::string & query) const {
    std::vector<CorpusRecord> result;
    for (const CorpusRecord & record : records_) {
        if (record.status == RecordStatus::VerifiedRecord
            && (query.empty() || record.content.find(query) != std::string::npos)) {
            result.push_back(record);
        }
    }
    return result;
}

bool CorpusStore::verify_integrity(std::vector<std::string> * failures) const {
    bool valid = true;
    for (const CorpusRecord & record : records_) {
        if (record.content_sha256 != sha256_text(record.content)) {
            valid = false;
            if (failures != nullptr) {
                failures->push_back(record.id);
            }
        }
    }
    return valid;
}

size_t CorpusStore::size() const {
    return records_.size();
}

} // namespace nexus
