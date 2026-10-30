#include <jni.h>
#include <node.h>
#include <vector>
#include <string>
#include <cstdio>
#include <cstdlib>
#include <unistd.h>
#include <sys/stat.h>

extern "C" JNIEXPORT jint JNICALL
Java_com_anyframe_app_service_LocalHttpService_runNode(JNIEnv* env, jobject, jobjectArray args) {
    const auto count = env->GetArrayLength(args);
    std::vector<std::string> strings;
    for (jsize i = 0; i < count; ++i) {
        auto value = static_cast<jstring>(env->GetObjectArrayElement(args, i));
        const char* chars = env->GetStringUTFChars(value, nullptr);
        strings.emplace_back(chars);
        env->ReleaseStringUTFChars(value, chars);
        env->DeleteLocalRef(value);
    }
    // Keep fatal startup diagnostics even when Node exits the entire host process.
    if (strings.size() > 2) {
        const auto& root = strings[2];
        if (chdir(root.c_str()) != 0) return 71;
        const auto temp = root + "/tmp";
        mkdir(temp.c_str(), 0700);
        setenv("HOME", root.c_str(), 1);
        setenv("TMPDIR", temp.c_str(), 1);
        setenv("NODE_PATH", (root + "/node-runtime").c_str(), 1);
        const auto path = strings[2] + "/node-console.log";
        freopen(path.c_str(), "a", stderr);
        freopen(path.c_str(), "a", stdout);
        setvbuf(stderr, nullptr, _IONBF, 0);
        setvbuf(stdout, nullptr, _IONBF, 0);
    }
    // Node expects mutable, contiguous argv storage (uv_setup_args / process title).
    std::vector<char> storage;
    size_t bytes = 0;
    for (const auto& value : strings) bytes += value.size() + 1;
    storage.reserve(bytes);
    for (const auto& value : strings) { storage.insert(storage.end(), value.begin(), value.end()); storage.push_back('\0'); }
    std::vector<char*> argv;
    size_t offset = 0;
    for (const auto& value : strings) { argv.push_back(storage.data() + offset); offset += value.size() + 1; }
    argv.push_back(nullptr);
    return node::Start(count, argv.data());
}
