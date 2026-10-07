---
title: Native Pi UI
description: Using the Sketchatone native Kivy dashboard on Raspberry Pi
---

# Native Pi UI

The native Sketchatone UI is a fullscreen touchscreen dashboard built specifically for the Raspberry Pi appliance. Rather than opening a browser, the app runs directly on the Pi's 800×480 DSI display — boots straight into the dashboard, no desktop environment required.

It covers the same ground as the [Web Dashboard](/about/dashboard/) but is designed for on-device use: large touch-friendly controls, instant startup, and a layout optimised for the small screen.

---

## Accessing the UI

On a configured Pi the UI starts automatically when the tablet is plugged in and the Pi boots. If you've set up autostart via `sudo sketchatone-ui-configure`, the dashboard appears on the DSI display within a few seconds of login.

To start it manually (e.g. during development):

```bash
sudo sketchatone-ui --fullscreen -c /opt/sketchatone-ui/configs/config.json
```

See **[Python CLI](/about/python-cli/#ui)** for the full list of flags.

---

## Navigation

The dashboard is organised into three **category tabs** across the top of the screen, each containing several **panels**:

| Category | Panels |
|---|---|
| **Monitor** | Performance, MIDI Devices, Tablet, MIDI In, Events |
| **Sound** | Velocity, Duration, Pitch, Strumming, Release, Slide |
| **Song** | Actions, Groups, Device Buttons, Chord Progressions |

Tap a category tab to switch category. Within each category, a row of panel tabs appears below — tap a panel tab to switch panels. Only the visible panel receives live tablet and strum events, so switching away from a visualiser panel frees CPU for the audio path.

---

## Monitor

### Performance

The default panel on launch. Shows the current button mapping — which chord or action is assigned to each tablet button — and a horizontal string visualiser that highlights which string is plucked as you strum. Useful for a quick sanity check that buttons and chords are wired up correctly before playing.

### MIDI Devices

Lists available MIDI output and input ports. Select your output device (synth, DAW, MPC) from the dropdown and optionally connect a MIDI keyboard as a chord input. Use **Refresh Devices** after plugging in hardware. A warning appears if the selected input and output form a feedback loop (e.g. both pointing at the same ALSA port).

### Tablet

A live canvas showing the pen's current position as a dot, plus a stylus graphic indicating pressure and tilt. The readout strip below shows raw X, Y, Pressure, Tilt X, and Tilt Y values. Useful for verifying the tablet is communicating correctly and for understanding how tilt and pressure map to the physical pen angle.

### MIDI In

Shows the currently connected MIDI input device and any incoming MIDI note data. Useful when using a MIDI keyboard to switch chords — confirms the keyboard notes are arriving and being interpreted correctly.

### Events

A live feed of raw tablet events: event count, per-field values (X, Y, Pressure, Tilt X, Tilt Y), button chip states, and the most recent strum (type pill + note chips). Good for debugging unexpected behaviour or understanding how your tablet movements translate before they reach the strummer.

---

## Sound

### Velocity

Configure how hard notes are struck. Choose a control source (pressure, tilt, position, or a fixed value), set the response curve, and adjust min/max range. Changes apply immediately — strum while adjusting to hear the effect.

### Duration

Configure how long notes ring. Same control-source and curve options as Velocity. The Duration panel is most useful when you want tilt angle to lengthen notes as you lean the pen.

### Pitch

Configure pitch bend. Choose a control source (tilt Y is the default — lean the pen to bend), set the bend range and response curve. See **[Pitch Bend](/about/pitch-bend/)** for a full explanation of how this works.

### Strumming

Core strumming settings: chord selection, MIDI channel, pressure threshold, note spread, invert X (for left-handed strumming), and repeater settings. These are the most frequently adjusted settings mid-session. Changes apply immediately without restarting.

### Release

Configure a drum hit or accent note that fires when you lift the pen. Enable/disable, select the MIDI note, set a max-duration threshold (so only quick lifts trigger it), and adjust the velocity multiplier relative to the strum.

### Slide

Slide mode settings. When enabled, sliding the pen horizontally without crossing a string boundary bends the pitch continuously rather than triggering a new strum. See **[Slide Mode](/about/slide-mode/)** for details.

---

## Song

### Actions

Map stylus buttons, tablet express keys, and keyboard keys to actions: chord changes, transpose, repeater toggle, slide mode, and more. Each mapping specifies a trigger (press or release) and an action. The button grid shows which buttons are currently detected on your device.

### Groups

Create button groups for chord progressions — a set of buttons that each map to a different chord, styled as a group in the UI so you can see at a glance which chord is active. Groups appear in the Performance panel's button map.

### Device Buttons

Discover and label the express keys on your specific tablet. Press each physical button to capture its HID scan code, then give it a friendly name. This makes the Actions panel easier to read when setting up mappings.

### Chord Progressions

Manage named chord progressions. Each progression is a sequence of chords you can step through with a button press. Create progressions for songs, switch between them mid-performance, and assign the step-forward and step-back actions to any button.

---

## Connecting from a browser

The native UI and the web dashboard are complementary — you can run both at once. Start the UI with `--enable-ws` to also expose the WebSocket server on your local network:

```bash
sudo sketchatone-ui --fullscreen --enable-ws \
    -c /opt/sketchatone-ui/configs/config.json
```

Then open a browser on another device to `http://<pi-hostname>.local` (if HTTP is enabled in the config) or connect a WebSocket client to `ws://<pi-hostname>:8081`. Changes made in either the native UI or the browser dashboard are reflected in both.

---

## Config management

### Loading a config

From any panel, the status bar at the bottom shows the current config name. Tap it to open the config picker and switch to a different saved config. Useful for switching between songs with different chord and parameter settings.

### Saving changes

Most changes (chord selection, parameter mappings, action rules) are applied in real time and saved automatically. Settings that affect the server process (MIDI backend, port selection) are saved to the config file and take effect on the next restart.

### Creating a new config

From the Server Settings panel (accessible via the status bar), enter a name and tap **Create Config** to save the current state as a new named config.

---

## Troubleshooting

**UI doesn't appear on boot** — Check the log file:

```bash
cat ~/.local/share/sketchatone-ui.log
```

**Tablet not detected** — The UI will wait for a tablet if `--poll` is set. If the tablet was plugged in after boot, the udev rules should trigger detection automatically. Check the log for `[Tablet] connected` or error messages.

**Dashboard feels sluggish** — The UI runs at 15 fps by default, which is appropriate for a settings dashboard. If you need smoother response, see **[Performance](/about/performance/)** for tuning options.

**Can't connect from a browser** — Make sure `--enable-ws` is set and the WebSocket port (default 8081) is reachable. The status bar at the bottom of the native UI shows the WebSocket address.

---

## See Also

- **[Web Dashboard](/about/dashboard/)** — The browser-based equivalent
- **[Python CLI](/about/python-cli/#ui)** — All `sketchatone-ui` flags
- **[CLI Flags](/about/cli-flags/#ui-python-only)** — Full flag reference
- **[Performance](/about/performance/)** — Latency tuning for the Pi
- **[Builds & Installers](/about/builds/)** — Installing the UI `.deb`
