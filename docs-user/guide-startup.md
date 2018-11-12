# Profiling Firefox Startup

1. Start your Firefox with the environment variable `MOZ_PROFILER_STARTUP=1` set. This way the profiler is started as early as possible during startup.

2. Then capture the profile using the add-on as usual.

Startup profiling does not use the settings that you configured in the add-on's panel. It uses settings that can be configured with the environment variables `MOZ_PROFILER_STARTUP_ENTRIES` and `MOZ_PROFILER_STARTUP_INTERVAL`:

* If it looks like the buffer is not large enough, you can tweak the buffer size with the env var `MOZ_PROFILER_STARTUP_ENTRIES`. This defaults to 1000000, which is 9MB. If you want 90MB use 10000000, and 20000000 for 180MB, which are good values to debug long startups.

* If you'd like a coarser resolution, you can also choose a different interval using `MOZ_PROFILER_STARTUP_INTERVAL`, which defaults to 1 (unit is millisecond). You can't go below 1 ms but you can use e.g. 10 ms.