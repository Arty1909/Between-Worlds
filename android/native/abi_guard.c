#include <jni.h>

#if !defined(__aarch64__) || !defined(__ANDROID__)
#error "This distribution is exclusively for Android arm64-v8a."
#endif

/* Loaded at startup. Packaging this ARM64-only library makes Android enforce
 * the requested ABI at installation. Story and media remain in the WebView;
 * this is an architecture gate, not a native port of the game engine. */
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM *vm, void *reserved) {
    (void)vm;
    (void)reserved;
    return JNI_VERSION_1_6;
}
