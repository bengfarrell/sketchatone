---
title: Performance
description: How Sketchatone keeps strumming latency low on Raspberry Pi — GC tuning, Kivy render isolation, and diagnostic tools
---

# Performance & Latency

This page documents every latency investigation we've done on the Raspberry Pi
appliance, what we found, what we fixed, and the tools available for future
diagnosis. The target is **glitch-free MIDI output** from a HID drawing tablet
at all times — even while the Kivy UI is rendering.

---

## The stutter problem

Intermittent stutters presented as buffered notes playing all at once after
a brief pause. The pen HID reader (`hid.device.read()`) occasionally blocked
for 168–393 ms, which is long enough to be clearly audible.

We worked through several candidate causes in order:

### Investigation path

| Stage | Hypothesis | Result |
|---|---|---|
| 1 | GC gen-1/gen-2 pauses during play | **Confirmed** — first fix shipped |
| 2 | USB autosuspend putting the tablet to sleep | Ruled out (udev rule already present) |
| 3 | Kivy touchscreen events competing for GIL | Ruled out — user doesn't use the touchscreen while strumming |
| 4 | GIL contention between Kivy render loop and HID thread in the same process | **Confirmed partial contributor** — led to subprocess refactor |
| 5 | Asyncio event loop overhead in the server process | Ruled out — standalone server + web UI was clean |
| 6 | OS-level CPU contention: Kivy at 60 fps starving the server subprocess | **Primary remaining cause** |

### What fixed it

Three independent changes, each addressing a different layer:

1. **GC tuning** — raised thresholds + cooperative idle scheduler (always on)
2. **Subprocess bridge** — server runs in its own process with its own GIL
3. **Kivy render optimisations** — 15 fps cap + single-panel event dispatch

---

## Garbage collection

### Background

Every Python process has two memory managers:

1. **Reference counting** — frees objects immediately when the count hits zero.
   Fast and pause-free. Not what causes stutters.
2. **Cyclic GC** (`gc` module) — detects reference cycles that reference
   counting can't handle. While it walks the object graph it holds the GIL,
   freezing all Python threads. This is the "stop the world" pause that causes
   audible hitches.

The cyclic collector runs in three generations:

| Generation | Contents | Sweep cost |
|---|---|---|
| gen-0 | Freshly allocated objects | Cheap (< 5 ms) |
| gen-1 | Survived one gen-0 sweep | Moderate (10–100 ms) |
| gen-2 | Long-lived objects | Expensive (60–300 ms+) |

Python's defaults (`700, 10, 10`) are tuned for scripts, not real-time audio
paths. A mid-sweep gen-1 or gen-2 collection can freeze the pen HID reader for
50–300 ms — long enough to be audible.

### Symptoms we observed

- ~100 ms hitches during play → correlated with `gc.pause.gen1` in perf logs
- ~300 ms hitches → correlated with `gc.pause.gen2`, usually after a burst of
  JSON traffic from chord changes or config broadcasts
- Hitch on the **first stroke after a brief pause** — idle scheduler fired a
  gen-1 sweep during the silence, still held the GIL when the next stroke arrived

### Current state (always on)

#### 1. Raised thresholds

```python
gc.set_threshold(10000, 500, 50)
```

vs. Python's default `(700, 10, 10)`. Gen-1 fires ~50× less on its own
timing; gen-2 ~5× less. Most sweeps get pre-empted by the idle scheduler
running during silence.

#### 2. Cooperative idle scheduler

A daemon thread (`_gc_idle_loop`) wakes every 100 ms and checks
`_last_strum_activity_ts`, which is updated on:

- Every pen sample with `pressure > 0` or `state == 'contact'`
- Every keyboard key press (before the auto-repeat check)
- Every chord change (via `_on_strummer_notes_changed`)

| Sweep | Idle required | Extra condition |
|---|---|---|
| `gc.collect(0)` | 120 ms | — |
| `gc.collect(1)` | 750 ms | 5 prior consecutive gen-0 sweeps |

Gen-0 is cheap enough to run in a brief between-strum pause without being
noticed. Gen-1 only runs when the user is genuinely idle — 750 ms is well
beyond a normal between-strum gap but short enough to prevent build-up.

#### 3. One-shot startup `gc.collect(2)`

Runs at the end of `SketchatoneServer.__init__` after all imports, config
parsing, and wiring. Drains startup garbage that would otherwise sit in gen-2
and cause a ~285 ms hitch on the first sweep.

### GC env-var overrides

For diagnostics only — do not set in production.

| Variable | Effect |
|---|---|
| `SKETCHATONE_GC_DISABLE=1` | Disable cyclic GC entirely. Zero pauses, memory grows over time. Use for A/B testing. |
| `SKETCHATONE_GC_IDLE_DISABLE=1` | Turn off the idle scheduler. Auto-GC still runs on raised thresholds. |
| `SKETCHATONE_GC_THRESHOLDS=a,b,c` | Override thresholds. Example: `700,10,10` restores Python defaults. |

### GC tunable locations

All in `python/sketchatone/cli/server.py`:

- `gc.set_threshold(...)` in `SketchatoneServer.__init__` (near the `SKETCHATONE_GC_THRESHOLDS` env parse)
- `_gc_idle_loop()` — contains `gen0_idle_ms`, `gen1_idle_ms`, `tick_ms`, `gen1_every_n_gen0`
- One-shot `self._gc.collect(2)` at the end of `__init__`
- `_last_strum_activity_ts` writes in `on_tablet_event`, `_handle_keyboard_key_press`, `_on_strummer_notes_changed`

---

## Subprocess bridge

### Why

After GC fixes, stutters still appeared when the Kivy UI was running.
Testing confirmed the pattern:

- `midi_strummer.py` alone → no stutter
- `server.py` standalone + web UI → no stutter
- Full Kivy UI → stutter returns

Running the server as a subprocess gives it its own Python GIL and its own OS
scheduling quantum, so Kivy's render loop can't steal cycles from the HID
reader thread even when both are CPU-hungry.

### Architecture

```
┌─────────────────────────┐      WebSocket      ┌──────────────────────────────┐
│  Kivy process (UI)      │ ◄──────────────────► │  Server subprocess           │
│                         │   ws://127.0.0.1:    │                              │
│  UIBridge               │       8081           │  StrummerWebSocketServer     │
│  ├─ asyncio WS client   │                      │  ├─ HID reader thread        │
│  ├─ send queue          │                      │  ├─ strummer thread          │
│  └─ Kivy event dispatch │                      │  └─ asyncio WS server        │
└─────────────────────────┘                      └──────────────────────────────┘
```

The bridge (`python/sketchatone/ui/bridge.py`) spawns the server with
`--no-http --no-https` (avoids the port < 1024 root requirement), retries
the WebSocket connection for up to 12 seconds, then forwards messages to Kivy
widget callbacks via `Clock.schedule_once`.

### Outgoing commands

All config changes, MIDI device selection, and button detection toggles flow
back from the Kivy UI to the server subprocess over the same WebSocket
connection. The bridge provides thread-safe `_send()` via
`loop.call_soon_threadsafe(queue.put_nowait, ...)`.

---

## Kivy render optimisations

### Framerate cap — 15 fps (default)

Kivy defaults to 60 fps. At 60 fps on a Pi 4, the render loop consumes
enough CPU to cause OS-level scheduling pressure on the server subprocess's
HID reader thread even across process boundaries.

The cap is set via `KivyConfig.set('graphics', 'maxfps', ...)` before Window
initialisation. 15 fps is imperceptible on a settings dashboard and frees
a large share of CPU for the audio path.

**CLI flag:** `--fps N` (default: `15`)

```bash
sketchatone-ui --fps 15 -c /opt/sketchatone-ui/configs/config.json
```

### Single-panel event dispatch

All dashboard panels (`EventsPanel`, `PerformancePanel`,
`TabletVisualizerPanel`, `ParameterMappingPanel`) subscribe to high-frequency
`tablet` and `strum` events. Previously all panels were subscribed
simultaneously, so every pen sample triggered 4+ Kivy widget update callbacks
even though only one panel was visible — effectively multiplying render work
by the number of visible panels.

**Fix:** each of these panels has a `_viz_active` flag (default `False`). Its
`_on_tablet` and `_on_strum` callbacks return immediately when inactive.
`PanelArea.set_active()` calls `set_viz_active(False)` on the outgoing panel
and `set_viz_active(True)` on the incoming one. Config, MIDI, and status
events remain always-subscribed because they are infrequent.

---

## Performance logging

All instrumentation is opt-in via `SKETCHATONE_STRUM_PERF=1`. Every ~30 s
the server prints a `[PERF]` summary:

| Bucket | Meaning |
|---|---|
| `tablet.gap` | Time between consecutive pen samples reaching our callback. Anything over ~15 ms is audible. |
| `hid.read_active` | Time inside `hid.device.read()` when it returned data. High values → USB/OS delivery, not Python. |
| `hid.read_idle` | Time inside `hid.device.read()` when it timed out (500 ms). Filtered from interesting metrics. |
| `hid.dispatch` | Time our HID callback code takes. Should stay < 1 ms. |
| `gc.pause.gen0/1/2` | Duration of **auto-triggered** GC sweeps (the bad ones). |
| `gc.idle_sweep_gen0/1` | Duration of **cooperative** sweeps (OK — only run during silence). |
| `strum.compute`, `kbd.press.*`, `broadcast.config`, `notes_changed.cb` | Fine-grained strum path timings. |

Launch with perf logging:

```bash
sudo SKETCHATONE_STRUM_PERF=1 KIVY_LOG_LEVEL=warning \
    python -u -m sketchatone.cli.ui \
    --throttle 33 \
    -c public/configs/default.json \
    --enable-ws
```

---

## Diagnostic tools

### `--shell` mode

Runs a nearly-idle 1 fps Kivy window alongside the server subprocess with no
UI panels loaded. Use this to isolate whether a stutter comes from Kivy widget
rendering or from the server/OS layer. If the stutter disappears in shell mode
but returns with the full UI, Kivy render work is the bottleneck.

```bash
sketchatone-ui --shell -c /opt/sketchatone-ui/configs/config.json
```

### `--fps` flag

Tune the Kivy render cap at launch without touching code:

```bash
sketchatone-ui --fps 30 -c /opt/sketchatone-ui/configs/config.json
```

---

## Diagnostic playbook

When a new hitch shows up:

1. **Reproduce with `SKETCHATONE_STRUM_PERF=1`.** Note the `[PERF]` window
   in which the hitch occurred.
2. **Check `tablet.gap.max`.** Under ~15 ms → the pen thread was fine; the
   hitch is downstream (MIDI backend, audio device, synth).
3. **If `tablet.gap.max` is high, check `gc.pause.*` and `gc.idle_sweep_*`:**
   - `gc.pause.gen1` or `gc.pause.gen2` non-zero → auto-GC fired during play.
     Consider raising thresholds further.
   - `gc.idle_sweep_gen1` large near a hitch → idle scheduler collided with
     resumed play. Raise `gen1_idle_ms` in `_gc_idle_loop`.
   - Both quiet, `hid.read_active.max` high → USB/OS scheduling delivered the
     packet late. Look at USB port, kernel autosuspend, or CPU governor.
4. **Confirm with `SKETCHATONE_GC_DISABLE=1`.** Hitch disappears → GC is the
   cause. Hitch persists → look elsewhere.
5. **Run `--shell` mode.** Hitch disappears → Kivy render work is the cause.
   Try reducing `--fps` or switching to a non-visualising panel.

---

## Rules of thumb

- **Never call `gc.collect()` synchronously from the pen thread or audio path.**
- **Any new "user is playing" signal must update `_last_strum_activity_ts`.**
  Otherwise the idle scheduler may fire during activity it doesn't recognise.
- **Keep per-strum allocations small.** Lower allocation rate → less frequent
  auto-GC. Avoid `dict`/`list` churn in the hot path.
- **JSON serialisation for WebSocket broadcasts is a major allocator.** Chord
  changes broadcast the entire config; `strummer.strumming.chord` updates skip
  config persistence specifically to halve allocation cost per strum.
