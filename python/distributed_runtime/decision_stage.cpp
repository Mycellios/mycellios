// Mycellios bounded stdio stage primitive. Network admission belongs to its parent.
// Links to the pinned MIT ggmlc runtime and its MIT JSON utility.
#include "ggmlc/loader.h"
#include "ggmlc/executor.h"
#include "json_util.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstring>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <set>
#include <stdexcept>
#include <thread>
#include <unordered_map>
#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#include <windows.h>
#include <fcntl.h>
#include <io.h>
#else
#include <fcntl.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

using laya::JsonValue;
constexpr uint32_t MAX_FRAME_HEADER = 16384;
constexpr size_t MAX_TENSOR_BYTES = 64 * 1024 * 1024;

uint32_t bounded_argument(const char* text, uint32_t maximum) {
    uint64_t value = 0;
    if (!text || !*text) throw std::runtime_error("stage_owner_argument_invalid");
    for (const char* p = text; *p; ++p) {
        if (*p < '0' || *p > '9') throw std::runtime_error("stage_owner_argument_invalid");
        value = value * 10 + (*p - '0');
        if (value > maximum) throw std::runtime_error("stage_owner_argument_invalid");
    }
    if (!value) throw std::runtime_error("stage_owner_argument_invalid");
    return static_cast<uint32_t>(value);
}

// This guard lives in the child, independently of Python's policy/permit watcher.
// An actor crash or forced task termination must not leave model work orphaned.
class StageLifetime {
#ifdef _WIN32
    HANDLE parent = nullptr, finished = nullptr;
    std::thread watcher;
#endif
public:
    StageLifetime(uint32_t parent_pid, uint32_t budget_ms) {
#ifdef _WIN32
        if (parent_pid == GetCurrentProcessId()) throw std::runtime_error("stage_owner_pid_invalid");
        parent = OpenProcess(SYNCHRONIZE, FALSE, parent_pid);
        if (!parent || WaitForSingleObject(parent, 0) != WAIT_TIMEOUT)
            throw std::runtime_error("stage_owner_not_alive");
        finished = CreateEventW(nullptr, TRUE, FALSE, nullptr);
        if (!finished) throw std::runtime_error("stage_owner_watch_unavailable");
        watcher = std::thread([this, budget_ms]() {
            HANDLE handles[] = {finished, parent};
            DWORD result = WaitForMultipleObjects(2, handles, FALSE, budget_ms);
            if (result != WAIT_OBJECT_0) {
                const UINT code = result == WAIT_TIMEOUT ? 124 : 125;
                TerminateProcess(GetCurrentProcess(), code);
                std::_Exit(code); // fail closed if the Win32 call itself fails
            }
        });
#else
        throw std::runtime_error("stage_windows_owner_watch_required");
#endif
    }
    ~StageLifetime() {
#ifdef _WIN32
        if (finished) SetEvent(finished);
        if (watcher.joinable()) watcher.join();
        if (finished) CloseHandle(finished);
        if (parent) CloseHandle(parent);
#endif
    }
    StageLifetime(const StageLifetime&) = delete;
    StageLifetime& operator=(const StageLifetime&) = delete;
};

void install_qualification_budget(bool mapped_reference) {
#ifdef _WIN32
    // Cap this process before mapping weights or preparing graphs. The lifetime
    // guard additionally observes parent death and an independent wall deadline.
    // Public execution still requires the parent worker's owner admission.
    HANDLE job = CreateJobObjectA(nullptr, nullptr);
    if (!job) throw std::runtime_error("stage_job_creation_failed");
    JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits{};
    limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_PROCESS_MEMORY | JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
    if (mapped_reference) {
        limits.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_WORKINGSET;
        limits.BasicLimitInformation.MinimumWorkingSetSize = size_t(16) * 1024 * 1024;
        limits.BasicLimitInformation.MaximumWorkingSetSize = size_t(1536) * 1024 * 1024;
    }
    limits.ProcessMemoryLimit = size_t(2) * 1024 * 1024 * 1024;
    JOBOBJECT_CPU_RATE_CONTROL_INFORMATION cpu{};
    cpu.ControlFlags = JOB_OBJECT_CPU_RATE_CONTROL_ENABLE | JOB_OBJECT_CPU_RATE_CONTROL_HARD_CAP;
    cpu.CpuRate = 2000;
    if (!SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits, sizeof(limits))
        || !SetInformationJobObject(job, JobObjectCpuRateControlInformation, &cpu, sizeof(cpu))
        || !AssignProcessToJobObject(job, GetCurrentProcess()))
        throw std::runtime_error("stage_job_budget_not_enforced");
    // Keep the handle for the process lifetime; exit closes it and kills children.
#else
    throw std::runtime_error("stage_windows_qualification_budget_required");
#endif
}

struct MappedFile {
    const uint8_t* data = nullptr;
    size_t size = 0;
#ifdef _WIN32
    HANDLE file = INVALID_HANDLE_VALUE, mapping = nullptr;
    explicit MappedFile(const char* path) {
        file = CreateFileA(path, GENERIC_READ, FILE_SHARE_READ, nullptr, OPEN_EXISTING, FILE_ATTRIBUTE_NORMAL, nullptr);
        LARGE_INTEGER n;
        if (file == INVALID_HANDLE_VALUE || !GetFileSizeEx(file, &n) || n.QuadPart <= 0)
            throw std::runtime_error("stage_file_unavailable");
        size = static_cast<size_t>(n.QuadPart);
        mapping = CreateFileMappingA(file, nullptr, PAGE_READONLY, 0, 0, nullptr);
        if (mapping) data = static_cast<const uint8_t*>(MapViewOfFile(mapping, FILE_MAP_READ, 0, 0, 0));
        if (!data) throw std::runtime_error("stage_mapping_failed");
    }
    ~MappedFile() { if (data) UnmapViewOfFile(data); if (mapping) CloseHandle(mapping); if (file != INVALID_HANDLE_VALUE) CloseHandle(file); }
#else
    int file = -1;
    explicit MappedFile(const char* path) {
        file = open(path, O_RDONLY);
        struct stat s{};
        if (file < 0 || fstat(file, &s) || s.st_size <= 0) throw std::runtime_error("stage_file_unavailable");
        size = static_cast<size_t>(s.st_size);
        void* p = mmap(nullptr, size, PROT_READ, MAP_PRIVATE, file, 0);
        if (p == MAP_FAILED) throw std::runtime_error("stage_mapping_failed");
        data = static_cast<const uint8_t*>(p);
    }
    ~MappedFile() { if (data) munmap(const_cast<uint8_t*>(data), size); if (file >= 0) close(file); }
#endif
};

const JsonValue& field(const JsonValue& j, const char* name) {
    const auto* p = j.get(name);
    if (!p) throw std::runtime_error("stage_required_field_missing");
    return *p;
}

int64_t integer(const JsonValue& j, int64_t lo, int64_t hi) {
    if (!j.is_number() || !std::isfinite(j.n) || std::floor(j.n) != j.n || j.n < lo || j.n > hi)
        throw std::runtime_error("stage_integer_out_of_range");
    return static_cast<int64_t>(j.n);
}

void write_header(const JsonValue& h) {
    const auto s = laya::json_dumps(h);
    if (s.size() > MAX_FRAME_HEADER) throw std::runtime_error("stage_response_header_too_large");
    uint32_t n = static_cast<uint32_t>(s.size());
    char b[4] = {static_cast<char>(n), static_cast<char>(n >> 8), static_cast<char>(n >> 16), static_cast<char>(n >> 24)};
    std::cout.write(b, 4).write(s.data(), s.size());
}

int main(int argc, char** argv) {
    try {
#ifdef _WIN32
        _setmode(_fileno(stdin), _O_BINARY);
        _setmode(_fileno(stdout), _O_BINARY);
#endif
        if (argc == 2 && std::string(argv[1]) == "--devices") {
            install_qualification_budget(false);
            JsonValue available = JsonValue::array();
            for (const auto& device : ggmlc::ModelExecutor::get_available_devices())
                available.arr.push_back(JsonValue::string(device));
            std::cout << laya::json_dumps(JsonValue::object({{"devices", available},
                {"modelExecuted", JsonValue::boolean(false)}})) << "\n";
            return 0;
        }
        if (argc == 4 && std::string(argv[1]) == "--lifetime-probe") {
            const auto budget = bounded_argument(argv[3], 240000);
            install_qualification_budget(true);
            StageLifetime owner(bounded_argument(argv[2], 0xffffffffu), budget);
            std::cout << "{\"event\":\"stage_lifetime_probe_ready\",\"modelExecuted\":false}" << std::endl;
            std::this_thread::sleep_for(std::chrono::milliseconds(budget + 1000));
            return 3; // The independent watchdog must have terminated this probe.
        }
        if (argc != 7) throw std::runtime_error("usage_stage_shard_device_threads_mmap_owner_pid_budget_ms");
        std::string device = argc > 2 ? argv[2] : "cpu";
        const std::set<std::string> devices = {"cpu", "cuda", "cuda:0", "vulkan", "vulkan:0", "vulkan:1", "vulkan:2"};
        if (!devices.count(device)) throw std::runtime_error("stage_device_invalid");
        int threads = argc > 3 ? std::stoi(argv[3]) : 2;
        if (threads < 1 || threads > 4) throw std::runtime_error("stage_threads_invalid");
        bool mapped_reference = argc > 4 && std::string(argv[4]) == "mmap";
        if (argc > 4 && (!mapped_reference || device != "cpu")) throw std::runtime_error("stage_mmap_mode_invalid");
        install_qualification_budget(mapped_reference);
        StageLifetime owner(bounded_argument(argv[5], 0xffffffffu), bounded_argument(argv[6], 240000));
        MappedFile mapped(argv[1]);
        // MappedFile outlives both graph and executor. No full-file private RAM copy.
        auto graph = ggmlc::ModelLoader::load_from_memory(mapped.data, mapped.size);
        ggmlc::ModelExecutor executor(graph, device);
        if (mapped_reference) executor.use_borrowed_cpu_weights();
        std::cerr << "{\"event\":\"stage_ready\",\"device\":\"" << executor.device()
                  << "\",\"ops\":" << graph.ops.size() << "}\n";
        for (;;) {
            unsigned char b[4];
            std::cin.read(reinterpret_cast<char*>(b), 4);
            if (!std::cin && std::cin.gcount() == 0) break;
            if (std::cin.gcount() != 4) throw std::runtime_error("stage_truncated_frame");
            uint32_t n = uint32_t(b[0]) | (uint32_t(b[1]) << 8) | (uint32_t(b[2]) << 16) | (uint32_t(b[3]) << 24);
            if (!n || n > MAX_FRAME_HEADER) throw std::runtime_error("stage_header_size_invalid");
            std::string text(n, '\0');
            if (!std::cin.read(text.data(), n)) throw std::runtime_error("stage_truncated_header");
            auto h = laya::JsonParser::parse_string(text);
            const auto& symbols = field(h, "symbols");
            const auto& tensors = field(h, "tensors");
            if (!symbols.is_object() || !tensors.is_array() || tensors.arr.size() != graph.inputs.size())
                throw std::runtime_error("stage_arity_mismatch");
            std::unordered_map<std::string, int64_t> env;
            for (const auto& sym : graph.symbol_table) {
                const auto* p = symbols.get(sym);
                if (!p) throw std::runtime_error("stage_symbol_missing");
                env[sym] = integer(*p, 1, 2048);
            }
            // This is an initial batch-one qualification primitive.
            if (env.size() != 2 || env.at("s20") != 1 || env.at("s53") > 2048)
                throw std::runtime_error("stage_shape_out_of_budget");
            auto start = std::chrono::steady_clock::now();
            executor.prepare(env, true);
            std::set<uint32_t> seen;
            size_t total = 0;
            for (const auto& tensor : tensors.arr) {
                uint32_t id = static_cast<uint32_t>(integer(field(tensor, "id"), 0, 1000000));
                size_t size = static_cast<size_t>(integer(field(tensor, "bytes"), 1, MAX_TENSOR_BYTES));
                if (!seen.insert(id).second || std::find(graph.inputs.begin(), graph.inputs.end(), id) == graph.inputs.end()
                    || size != executor.get_tensor_size_bytes(id) || total + size > MAX_TENSOR_BYTES)
                    throw std::runtime_error("stage_input_geometry_mismatch");
                total += size;
                std::vector<uint8_t> data(size);
                if (!std::cin.read(reinterpret_cast<char*>(data.data()), size)) throw std::runtime_error("stage_input_truncated");
                if (graph.tensors.at(id).type == GGML_TYPE_F32) {
                    for (size_t i = 0; i + 4 <= size; i += 4) {
                        float v;
                        std::memcpy(&v, data.data() + i, 4);
                        if (!std::isfinite(v)) throw std::runtime_error("stage_nonfinite_input");
                    }
                }
                executor.set_input(id, data.data(), data.size());
            }
            executor.run(threads);
            executor.synchronize();
            JsonValue out = JsonValue::array();
            size_t bytes = 0;
            for (uint32_t id : graph.outputs) {
                size_t size = executor.get_tensor_size_bytes(id);
                if (size > MAX_TENSOR_BYTES || bytes + size > MAX_TENSOR_BYTES) throw std::runtime_error("stage_output_budget_exceeded");
                bytes += size;
                out.arr.push_back(JsonValue::object({{"id", JsonValue::number(id)}, {"bytes", JsonValue::number(size)}}));
            }
            double ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
            write_header(JsonValue::object({{"tensors", out}, {"computeMs", JsonValue::number(ms)}, {"device", JsonValue::string(executor.device())}}));
            for (uint32_t id : graph.outputs)
                std::cout.write(static_cast<const char*>(executor.get_output_data(id)), executor.get_tensor_size_bytes(id));
            std::cout.flush();
            if (!std::cout) throw std::runtime_error("stage_output_closed");
        }
        return 0;
    } catch (const std::exception& e) {
        // No request body, tensor or credential is logged.
        std::cerr << "{\"event\":\"stage_failed\",\"reason\":\"" << laya::json_escape(e.what()) << "\"}\n";
        return 1;
    }
}
