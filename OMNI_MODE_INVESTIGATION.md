# Omni Mode (Multi-Channel MIDI) - Future Investigation

## Status: Not Currently Supported

As of v0.2.0, when `midi_channel` is `null` (the default), notes are sent on channel 1 only. Omni mode (sending on all 16 channels simultaneously) was removed because it caused severe timing issues.

## The Problem

When omni mode was enabled (`midi_channel: null` mapped to all 16 channels), every note-on and note-off was sent 16 times — once per channel. This caused:

- **16x MIDI traffic** on every strum, flooding the MIDI output buffer
- **Audible timing issues**: notes sounded "cut off", oversaturated, or had inconsistent durations
- **GIL starvation on macOS**: the HID packet processing thread (Python) held the GIL so tightly while sending 16x messages that the NoteScheduler thread couldn't fire note-offs on time

**Important note:** The Node.js implementation worked perfectly with omni mode — no timing issues, no audible artifacts. This is because Node.js uses a single-threaded async event loop with `setTimeout` for note-off scheduling, so there's no thread contention. The problem is specific to Python's GIL and its multi-threaded architecture (HID reader thread + NoteScheduler thread). This confirms the root cause is GIL contention, not a MIDI bandwidth issue.

## The Accidental Fix We Found

During debugging, we discovered that adding `sys.stderr.write(".\n")` in the HID packet processing loop (once per pressure event) completely fixed the timing issues — even with omni mode enabled. This works because:

1. Writing to a TTY file descriptor with a newline forces a **kernel-level syscall** that blocks the HID thread momentarily
2. This blocking creates a **GIL release point** that allows the NoteScheduler thread to run
3. `time.sleep()`, pipe writes, and `/dev/null` writes did NOT work — only TTY writes reliably yielded the thread on macOS

This strongly suggests the root cause is **Python GIL contention** between the HID reader thread and the NoteScheduler thread, exacerbated by the 16x message volume of omni mode.

## What We Tried That Didn't Work

| Approach | Result |
|----------|--------|
| `time.sleep(0.001)` - `time.sleep(0.005)` | No effect — macOS doesn't reliably yield on short sleeps |
| `os.write(pipe_fd, b".")` + `os.read(pipe_fd, 1)` | No effect |
| `os.write(devnull_fd, b"\n")` | No effect — `/dev/null` completes too fast |
| `sys.stdout.flush()` (no write) | No effect |
| `print(".", end="")` (no newline) | No effect — stdout buffers without newline |
| `sys.setswitchinterval()` | Not tested but unlikely to help given sleep didn't work |
| Moving note-off scheduling to asyncio `loop.call_later()` | Same GIL issue — asyncio thread also starved |

## What Worked

| Approach | Result |
|----------|--------|
| `sys.stderr.write(".\n")` | Fixed — TTY write with newline |
| `sys.stdout.write(".\n")` | Fixed — same mechanism |
| `print(".")` | Fixed — includes newline + TTY flush |

## Recommended Path Forward

To properly support omni mode in the future, consider:

1. **Move MIDI output to a separate process** (not thread). Use `multiprocessing` or a subprocess with a pipe/queue for note events. Separate processes have independent GILs, eliminating contention entirely.

2. **Batch MIDI messages**: Instead of sending 16 individual note-on messages, investigate if RtMidi or the OS MIDI layer supports batching multiple channel messages into a single operation.

3. **Rate-limit omni output**: If omni mode is re-enabled, add inter-message delays between channel sends (the `inter_message_delay` config already exists for this purpose on Raspberry Pi).

4. **Use the stderr workaround as a temporary measure**: If omni mode needs to ship before a proper fix, the `sys.stderr.write(".\n")` approach works reliably. On Raspberry Pi with systemd, stderr goes to journald which buffers it. On macOS terminal, it produces visible dots but could be redirected (`2>/dev/null`).

## Files Involved

- `python/sketchatone/midi/rtmidi_backend.py` — `_get_channels()` method
- `python/sketchatone/midi/jack_backend.py` — `_get_channels()` method
- `src/midi/rtmidi-backend.ts` — `_getChannels()` method
- `python/sketchatone/midi/note_scheduler.py` — NoteScheduler thread (daemon=False)
- `python/sketchatone/cli/server.py` — HID packet processing in `handle_packet()`