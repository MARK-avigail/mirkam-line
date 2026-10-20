// Experimental SDK clock compatibility only. Not loaded by the production bridge.
#define _GNU_SOURCE
#include <stdint.h>
#include <time.h>
#include <unistd.h>
#include <sys/syscall.h>
int QueryPerformanceCounter(int64_t *value) {
    struct timespec now;
    if (!value || clock_gettime(CLOCK_MONOTONIC, &now)) return 0;
    *value = (int64_t)now.tv_sec * 1000000000LL + now.tv_nsec;
    return 1;
}
int QueryPerformanceFrequency(int64_t *value) {
    if (!value) return 0;
    *value = 1000000000LL;
    return 1;
}
int GetCurrentThreadId(void) { return (int)syscall(SYS_gettid); }
// Linux monotonic clock precision needs no process-wide Windows timer request.
// These functions do not promise real-time scheduling or alter provider limits.
uint32_t timeBeginPeriod(uint32_t period) { return period ? 0 : 97; }
uint32_t timeEndPeriod(uint32_t period) { return period ? 0 : 97; }
