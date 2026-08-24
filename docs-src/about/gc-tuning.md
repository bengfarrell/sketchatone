---
title: GC Tuning
description: How the Python garbage collector affects strumming latency, and how Sketchatone tames it
---

# Garbage Collection & Real-Time Strumming

This page documents how Python's garbage collector interacts with the
strumming hot path, why it caused audible hitches, and the strategy
Sketchatone uses to keep collections out of the audible window. It's
here so you (or a future maintainer) can revisit the trade-offs when
tuning the app on new hardware.

## Background: two memory systems

Every Python process has **two** memory managers running at once:

1. **Reference counting** — every object tracks how many references
   point to it. When the count hits zero, the object is freed
   immediately. This is fast, incremental, and pause-free. It is
   *not* what causes audio glitches.
2. **Cyclic garbage collector** (the `gc` module) — reference
   counting can't detect **reference cycles** (e.g., two objects that
   reference each other but nothing else references them). To clean
   those up, Python periodically walks the object graph looking for
   unreachable cycles. **While this walk runs, no other Python thread
   can execute bytecode** (it holds the GIL). This is the "stop the
   world" pause we care about.

The cyclic collector runs in three **generations**:

| Generation | What it holds | Sweep cost |
|---|---|---|
| gen-0 | Freshly allocated objects | Cheap (< 5 ms) |
| gen-1 | Survived one gen-0 sweep | Moderate (10–100 ms) |
| gen-2 | Long-lived objects | Expensive (60–300 ms+) |

Sweeps are triggered by allocation counts, not by time. Python's
defaults (`(700, 10, 10)`) are tuned for scripts, not for a process
with a real-time audio path. On a busy strum, a mid-sweep can freeze
the pen HID reader for 50–300 ms — long enough to be audible as a
paused, delayed, or missed note.

## Symptoms we observed

- Occasional **~100 ms audio hitches during play** — correlated with
  `gc.pause.gen1` events in the perf log.
- Rare **~300 ms hitches** — correlated with `gc.pause.gen2` events,
  usually after a burst of allocation (WebSocket JSON traffic, chord
  changes, config broadcasts).
- Hitches on the **first stroke after a brief pause** — caused by
  the cooperative idle scheduler firing a gen-1 sweep during a
  300–500 ms "thinking pause," then still holding the GIL when the
  next stroke arrived.

## The fix (currently shipping)

Three independent changes, all always-on:

### 1. Raised auto-GC thresholds

```
gc.set_threshold(10000, 500, 50)
```

vs. the Python default of `(700, 10, 10)`. Gen-1 fires roughly 50×
less often on its own timing; gen-2 roughly 5× less often. Combined
with the idle scheduler below, most sweeps get pre-empted by our
proactive collection during silence.

### 2. Cooperative idle scheduler

A daemon thread (`_gc_idle_loop`) wakes every 100 ms and inspects
`_last_strum_activity_ts`, which is updated on:

- Every pen sample with `pressure > 0` or `state == 'contact'`
- Every keyboard key press (before the auto-repeat check)
- Every chord change (via `_on_strummer_notes_changed`)

The scheduler uses **two idle thresholds**:

| Sweep | Requires idle for | Also requires |
|---|---|---|
| `gc.collect(0)` | 120 ms | — |
| `gc.collect(1)` | 750 ms | 5 prior consecutive gen-0 sweeps at that level |

The two-threshold design exists because gen-0 is always cheap and can
run inside a brief pause without being noticed, but gen-1 is
expensive enough that it must only run when the user is *really* done
for the moment. Firing gen-1 at 120 ms of idle caused hitches on the
first stroke of the next phrase; 750 ms is well beyond a normal
between-strum pause.

### 3. One-shot startup `gc.collect(2)`

Runs at the end of `SketchatoneServer.__init__`, after all imports,
config parsing, and wiring. Drains the startup garbage that would
otherwise sit in gen-2 waiting for the first "catch-up" sweep to
find it (which we measured at ~285 ms in one session).

## Instrumentation (opt-in)

All of the perf logging is behind `SKETCHATONE_STRUM_PERF=1`. When
enabled, every ~30 seconds the server prints a `[PERF]` summary with:

| Bucket | Meaning |
|---|---|
| `tablet.gap` | Time between consecutive pen samples reaching our callback. Anything over ~15 ms is audible. |
| `hid.read_active` | Time inside `hid.device.read()` when it returned data. High values mean USB/OS delivery, not Python. |
| `hid.read_idle` | Time inside `hid.device.read()` when it timed out (500 ms). Filtered out of the interesting metrics. |
| `hid.dispatch` | Time our HID callback code takes. Should stay < 1 ms. |
| `gc.pause.gen0/1/2` | Duration of **auto-triggered** GC sweeps. These are the bad ones. |
| `gc.idle_sweep_gen0/1` | Duration of **our** cooperative sweeps. These are OK because they only run during silence. |
| `strum.compute`, `kbd.press.*`, `broadcast.config`, `notes_changed.cb` | Fine-grained timings for the strum path. |

Launch with:

```bash
sudo SKETCHATONE_STRUM_PERF=1 KIVY_LOG_LEVEL=warning \
    ./python/venv/bin/python -u -m sketchatone.cli.ui \
    --hot-reload --throttle 33 \
    -c public/configs/default.json \
    --enable-ws
```

## Escape hatches (env vars)

Available for diagnostics. None of these should be set in production.

| Variable | Effect |
|---|---|
| `SKETCHATONE_GC_DISABLE=1` | Disables cyclic GC entirely. Zero pauses, but memory grows over time (reference cycles never freed). Useful for A/B testing whether a hitch is GC-related. |
| `SKETCHATONE_GC_IDLE_DISABLE=1` | Turns off the cooperative idle scheduler. Auto-GC still runs on the raised thresholds. |
| `SKETCHATONE_GC_THRESHOLDS=a,b,c` | Overrides the raised thresholds with your own values. Example: `SKETCHATONE_GC_THRESHOLDS=700,10,10` restores Python defaults. |
| `SKETCHATONE_STRUM_PERF=1` | Enables the `[PERF]` instrumentation described above. |

## Diagnostic playbook

When a new hitch shows up:

1. **Reproduce with `SKETCHATONE_STRUM_PERF=1`.** Note the `[PERF]`
   window in which the hitch occurred.
2. **Read `tablet.gap.max` for that window.** If it's under ~15 ms,
   the pen thread was fine — the hitch is downstream (MIDI backend,
   audio device, synth).
3. **If `tablet.gap.max` is high, check `gc.pause.*` and
   `gc.idle_sweep_*` for the same window.**
   - `gc.pause.gen1` or `gc.pause.gen2` non-zero → auto-GC fired
     during play. Consider raising thresholds further.
   - `gc.idle_sweep_gen1` large and near a hitch → the idle
     scheduler collided with resumed play. Consider raising
     `gen1_idle_ms` in `_gc_idle_loop`.
   - Both quiet, but `hid.read_active.max` is high → USB/OS
     scheduling delivered the packet late. Not fixable in Python;
     look at USB port, kernel autosuspend, or CPU governor.
4. **Confirm with `SKETCHATONE_GC_DISABLE=1`.** If the hitch
   disappears entirely, GC is the cause and the tunables above are
   the right lever. If it persists, look elsewhere.

## Tunable locations

All in `python/sketchatone/cli/server.py`:

- `gc.set_threshold(...)` call in `SketchatoneServer.__init__`
  (near the `SKETCHATONE_GC_THRESHOLDS` env parse).
- `_gc_idle_loop()` method — contains `gen0_idle_ms`,
  `gen1_idle_ms`, `tick_ms`, `gen1_every_n_gen0`.
- One-shot `self._gc.collect(2)` at the end of `__init__`.
- `_last_strum_activity_ts` writes in `on_tablet_event`,
  `_handle_keyboard_key_press`, and `_on_strummer_notes_changed`.

## Rules of thumb

- **Never call `gc.collect()` synchronously from the pen thread or
  the audio path.** That defeats the whole point.
- **Any new "user is playing" signal should update
  `_last_strum_activity_ts`.** Otherwise the idle scheduler may fire
  during a signal we don't recognize as activity.
- **Keep per-strum allocations small.** The lower the allocation
  rate, the less often auto-GC fires. Avoid `dict`/`list` churn in
  the hot path; reuse buffers where you can.
- **JSON serialization for WebSocket broadcasts is a major allocator.**
  Chord changes broadcast the entire config; the persistence path
  was skipped for `strummer.strumming.chord` updates specifically
  because it doubled the allocation cost per strum.
