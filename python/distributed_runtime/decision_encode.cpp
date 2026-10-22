// Tokenization-only helper for the pinned ggmlc Kev recipe. No tensor execution.
#include "ggmlc/loader.h"
#include "ggmlc/pipeline/tokenizer.h"
#include "questions.h"
#include "recipe.h"
#include "sequence.h"
#include <algorithm>
#include <fstream>
#include <iostream>
#include <iterator>
#include <stdexcept>
#ifdef _WIN32
#include <io.h>
#include <fcntl.h>
#endif

int main(int argc, char** argv) {
    try {
#ifdef _WIN32
        _setmode(_fileno(stdout), _O_BINARY);
#endif
        if (argc != 3) throw std::runtime_error("usage_tokenizer_gguf_question_json");
        std::ifstream f(argv[2], std::ios::binary | std::ios::ate);
        if (!f || f.tellg() > 32768) throw std::runtime_error("question_file_invalid");
        f.seekg(0);
        std::string text((std::istreambuf_iterator<char>(f)), std::istreambuf_iterator<char>());
        auto request = laya::JsonParser::parse_string(text);
        const auto* state = request.get("state");
        const auto* qs = request.get("questions");
        if (!state || !qs || !qs->is_object() || qs->obj.size() != 1)
            throw std::runtime_error("one_question_required");
        if (!laya::validate_questions_json(*qs).empty()) throw std::runtime_error("question_schema_invalid");
        auto questions = laya::questions_from_json(*qs);
        auto graph = ggmlc::ModelLoader::load_from_file(argv[1]);
        laya::DecisionRecipe recipe;
        recipe.load_from_graph(graph, argv[1]);
        if (!recipe.baked || recipe.kind != "kev" || recipe.max_opts != 16 || recipe.max_len != 2048)
            throw std::runtime_error("unexpected_pinned_recipe");
        ggmlc::pipeline::BPETokenizer tokenizer;
        if (!tokenizer.init_from_gguf_file(argv[1])) throw std::runtime_error("tokenizer_failed");
        // The community Kev GGUF incorrectly selects Gemma solely because its
        // Qwen vocabulary exceeds 200k entries. Never silently serve that path.
        // decision_tokenize.py owns exact Hugging Face preprocessing; this C++
        // helper remains useful as an ASCII tensor-format qualification oracle.
        if (tokenizer.pre_tokenizer() == "gemma") throw std::runtime_error("kev_tokenizer_metadata_mismatch_use_hf_encoder");
        auto wide = recipe;
        wide.max_len = 65536;
        wide.head_max_len = 65536;
        auto encoded = laya::build_sequence(tokenizer, wide, laya::serialize_state(*state), questions[0]);
        if (encoded.ids.empty() || encoded.ids.size() > static_cast<size_t>(recipe.max_len)
            || encoded.markers.empty() || encoded.markers.size() > static_cast<size_t>(recipe.max_opts)
            || encoded.decide < 0) throw std::runtime_error("question_exceeds_model_limits");
        int seq = std::max(recipe.min_seq, static_cast<int>(encoded.ids.size()));
        std::vector<int32_t> ids, positions, qtypes, decide;
        std::vector<float> attention, mask;
        laya::pad_encoded_batch({encoded}, recipe, 1, seq, ids, attention, positions, mask, qtypes, decide);
        auto entry = [](int id, size_t size) {return laya::JsonValue::object({
            {"id", laya::JsonValue::number(id)}, {"bytes", laya::JsonValue::number(size)}});};
        auto h = laya::JsonValue::object({
            {"symbols", laya::JsonValue::object({{"s20", laya::JsonValue::number(1)}, {"s53", laya::JsonValue::number(seq)}})},
            {"questionId", laya::JsonValue::string(questions[0].id)},
            {"inputTokens", laya::JsonValue::number(encoded.ids.size())},
            {"tensors", laya::JsonValue::array({entry(433, ids.size()*4), entry(434, attention.size()*4),
                entry(435, positions.size()*4), entry(436, decide.size()*4), entry(437, mask.size()*4)})}});
        std::string out = laya::json_dumps(h);
        uint32_t n = static_cast<uint32_t>(out.size());
        char b[4] = {static_cast<char>(n),static_cast<char>(n>>8),static_cast<char>(n>>16),static_cast<char>(n>>24)};
        std::cout.write(b, 4).write(out.data(), out.size());
        std::cout.write(reinterpret_cast<const char*>(ids.data()), ids.size()*4);
        std::cout.write(reinterpret_cast<const char*>(attention.data()), attention.size()*4);
        std::cout.write(reinterpret_cast<const char*>(positions.data()), positions.size()*4);
        std::cout.write(reinterpret_cast<const char*>(decide.data()), decide.size()*4);
        std::cout.write(reinterpret_cast<const char*>(mask.data()), mask.size()*4);
        if (!std::cout) throw std::runtime_error("encoding_output_failed");
        return 0;
    } catch (const std::exception& e) {
        std::cerr << "{\"event\":\"encoding_failed\",\"reason\":\"" << laya::json_escape(e.what()) << "\"}\n";
        return 1;
    }
}
