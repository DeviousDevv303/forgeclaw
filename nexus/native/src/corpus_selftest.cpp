#include "corpus_store.hpp"

#include <cstdio>
#include <filesystem>
#include <iostream>
#include <stdexcept>
#include <string>

namespace {

void require(bool condition, const std::string & message) {
    if (!condition) {
        throw std::runtime_error(message);
    }
}

} // namespace

int main() {
    const std::filesystem::path path = std::filesystem::temp_directory_path() / "nexus-corpus-selftest.log";
    std::error_code error;
    std::filesystem::remove(path, error);

    try {
        nexus::CorpusStore store(path.string());
        store.load();

        const std::string valid_id = store.add_material("verified local knowledge");
        require(store.create_candidate(valid_id), "raw material did not become a candidate");
        require(store.admit_candidate(valid_id, true, "Guardian approved test record"), "valid candidate was not admitted");
        require(store.inspect(valid_id).status == nexus::RecordStatus::VerifiedRecord, "admitted record is not verified");

        const std::string rejected_id = store.add_material("unverified material");
        require(store.create_candidate(rejected_id), "second material did not become a candidate");
        require(!store.admit_candidate(rejected_id, false, "Guardian rejected test record"), "Guardian rejection was reported as success");
        require(store.inspect(rejected_id).status == nexus::RecordStatus::Rejected, "rejected candidate changed to the wrong state");
        require(store.search_verified("unverified").empty(), "rejected material was returned as verified");

        std::vector<std::string> failures;
        require(store.verify_integrity(&failures), "fresh Corpus failed its integrity check");

        nexus::CorpusStore reloaded(path.string());
        reloaded.load();
        require(reloaded.size() == 2u, "append-only replay did not retain two records");
        require(reloaded.inspect(valid_id).status == nexus::RecordStatus::VerifiedRecord, "verified state was not persisted");
        require(reloaded.inspect(rejected_id).status == nexus::RecordStatus::Rejected, "rejected state was not persisted");
        require(reloaded.search_verified("verified local").size() == 1u, "verified retrieval returned the wrong result count");
        require(reloaded.verify_integrity(&failures), "reloaded Corpus failed its integrity check");

        std::cout << "NEXUS_CORPUS_SELFTEST_PASSED records=" << reloaded.size() << '\n';
        std::filesystem::remove(path, error);
        return 0;
    } catch (const std::exception & exception) {
        std::cerr << "NEXUS_CORPUS_SELFTEST_FAILED " << exception.what() << '\n';
        std::filesystem::remove(path, error);
        return 1;
    }
}
