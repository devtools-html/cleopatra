# Potential performance data sources in Gecko

perf.html is only a client, it doesn't actually create the data it displays and analyzes. This page documents, from a high level, the various systems that are available for recording performance data within Gecko.

## Gecko Profiler (aka SPS, nsIProfiler)

The profiler collects two types of information, samples and markers. The profiler is an internal component inside of Gecko. It stores all of profile information in a circular buffer, that when it gets full, the buffer starts to overwrite the old data with new data. This is a nice feature because it means the profiler can be left on indefinitely, allowing for the easy capture of a profile once some kind of interesting behavior happens. Once the user is done profiling then the data can be retrieved as a JSON blob. The profiler can be configuring to collect data from different specific threads, and it stores this information on a per-thread basis.

### Samples in the profiler

Samples are taken of the current executing function at a fixed but configurable interval, e.g. every 1 millisecond. These samples are collected and provide a general statistical view of where time was spent executing code. The more a function is executed, the more samples show up in the buffer. These samples include a variety of data including their call stacks, and information about the function name. In JavaScript a string is provided with the function name, the file location, and the line number. C++ functions only contain their memory address. perf.html then must take the additional step of "symbolicating" these memory addresses, by looking up the original function names in a function symbol table that is specific to that individual build of Firefox or an individual library. Various reports can be generated from this data like the Stack Chart, but these are not guaranteed to be completely accurate, as the underlying data is sample-based.

### Markers in the profiler

Samples don't record every event that happens within the system, so some information gets lost. Markers on the other hand, get fired every time certain events happen within the system. These events can be arbitrarily added across Gecko by engineers wherever they may wish. This can be useful for exposing expensive operations that may be missed by the profiler, and the markers provide a precise view of how various systems are running.

### More Documentation on the Gecko Profiler:

 * [nsIProfiler.idl](https://dxr.mozilla.org/mozilla-central/source/tools/profiler/gecko/nsIProfiler.idl)
 * [ProfileEntry.h](https://dxr.mozilla.org/mozilla-central/rev/b043233ec04f06768d59dcdfb9e928142280f3cc/tools/profiler/core/ProfileBufferEntry.h#322-411)

 * [Profile Data Format](./profile-data)

## Timeline - DocShell Markers (unused in perf.html)

The Gecko Profiler records marker data, but it doesn't include all of the markers available in the system. There is a competing implementation of markers used exclusively by the Firefox Devtools that are recorded per DocShell. These are not currently integrated into perf.html.

* [Timeline C++ Implementation](https://dxr.mozilla.org/mozilla-central/source/docshell/base/timeline)
* [Timeline Devtools JS Server](https://dxr.mozilla.org/mozilla-central/source/devtools/server/performance/timeline.js)

## Task Tracer

TaskTracer provides a way to trace the correlation between different Runnables across threads and processes. These Runnables are defined by `mozilla::Runnable`, and represent a task which can be dispatched to a thread for execution. Unlike sampling based profilers, TaskTracer can tell you where a Runnable is dispatched from, what its original source was, how long it waited in the event queue, and how long it took to execute.

Source Events are usually some kinds of I/O events we're interested in, such as touch events, timer events, network events, etc. When a source event is created, TaskTracer records the entire chain of Runnables as they are dispatched to different threads and processes. It records latency, execution time, etc. for each Runnable that chains back to the original source event. There was an initial prototype of integrating this information into perf.html, but it has since been removed and is available under the git tag [tasktracer-removal](https://github.com/devtools-html/perf.html/releases/tag/tasktracer-removal).

* [GeckoTaskTracer.h](https://dxr.mozilla.org/mozilla-central/source/tools/profiler/tasktracer/GeckoTaskTracer.h)
* [Wiki](https://wiki.mozilla.org/TaskTracer)

## Tracelogger (unused in perf.html)

While the previous performance tools collect information about how Gecko runs as a whole, Tracelogger is specific to the SpiderMonkey engine. Tracelogger is not sample based, therefore it records every step that the SpiderMonkey engine performs to run a given chunk of JavaScript code. It's primarily used by JavaScript engineers, and includes a firehose of information often reaching into the several gigs of information. There is no current integration of this information with perf.html.

* [Tracelogger on GitHub](https://github.com/h4writer/tracelogger)
