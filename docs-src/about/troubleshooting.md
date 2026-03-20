---
title: Troubleshooting
description: Common issues and solutions
---

# Troubleshooting

This guide covers common issues and their solutions.

## MIDI Issues

### Notes Stick or Sustain Indefinitely

**Symptoms:**
- Notes continue playing after you stop strumming
- Notes don't turn off properly during rapid strumming
- Hardware synthesizer plays sustained notes that never end

**Cause:**
Some hardware synthesizers (especially when connected via USB MIDI) can't handle the rapid stream of MIDI messages during busy strumming. The MIDI buffer overflows, causing Note Off messages to be lost.

**Solution:**
Add a delay between MIDI messages using `midiInterMessageDelay`:

```json
{
  "midi": {
    "midiInterMessageDelay": 0.08
  }
}
```

**Recommended values:**
- `0.08` (80ms) - Good starting point for most hardware synths
- `0.05` (50ms) - Try if 80ms feels too sluggish
- `0.1` (100ms) - Use if notes still stick with lower values
- `0` (default) - No delay, maximum responsiveness

**Note:** This adds latency to MIDI output. Only use if experiencing stuck notes.

**Tested with:**
- Roland Juno-DS88 (USB MIDI) - Works with 0.08
- E-MU USB MIDI cables - May need adjustment

---

### No MIDI Output

**Symptoms:**
- No sound when strumming
- MIDI monitor shows no messages

**Solutions:**

1. **Check MIDI port connection:**
   ```bash
   # On Raspberry Pi (ALSA)
   aconnect -l
   
   # Look for your MIDI device and note the port number
   ```

2. **Verify config file:**
   ```json
   {
     "midi": {
       "midi_output_backend": "rtmidi",  // or "jack" for Zynthian
       "midi_output_id": 0  // Try different port numbers
     }
   }
   ```

3. **Check available ports:**
   - The server prints available MIDI ports on startup
   - Look for `[RtMidi] Available MIDI output ports:` in the console

4. **Test with virtual port:**
   Set `midi_output_id` to `null` - this creates a virtual MIDI port you can connect to

---

### MIDI Device Not Detected

**Symptoms:**
- Newly connected MIDI device doesn't appear in the dashboard
- Device list is empty or outdated

**Solution:**

After connecting or disconnecting a MIDI device:

**Via Dashboard:**
1. Connect your MIDI device
2. Click the **"Refresh Devices"** button in the MIDI configuration panel
3. Your device should now appear in the list

**Via Command Line:**
- Restart the server to detect new devices
- The server prints available MIDI ports on startup

---

### MIDI Input Not Working

**Symptoms:**
- Playing notes on external keyboard doesn't update strum notes in dashboard
- No MIDI input messages received

**Solutions:**

1. **Check input port configuration:**
   ```json
   {
     "midi": {
       "midi_input_id": 0,  // Specific port, or null for all ports
       "midi_input_exclude": [
         "Midi Through",
         "RtMidi"
       ]
     }
   }
   ```

2. **Verify port isn't excluded:**
   - The server automatically excludes the output port to prevent feedback
   - Check the `midi_input_exclude` list
   - Remove your keyboard's port name if it's being excluded

3. **Test with aseqdump (Raspberry Pi):**
   ```bash
   # List ports
   aconnect -l
   
   # Monitor a specific port (e.g., 28:0)
   aseqdump -p 28:0
   
   # Play notes on keyboard - you should see MIDI messages
   ```

---

## Post-Installation Configuration

### Setting Up MIDI Input (Optional)

**Strumming should work right away** after installation. However, if you want to use an external MIDI keyboard to change the notes being strummed (e.g., playing chords on a keyboard to update the strum pattern), you'll need to configure MIDI input.

**Find available MIDI input ports:**

```bash
# On Raspberry Pi (ALSA)
aconnect -l

# Look for your MIDI device in the output, e.g.:
# client 28: 'Juno-DS' [type=kernel,card=2]
#     0 'Juno-DS MIDI 1  '
#     1 'Juno-DS MIDI 2  '
```

The port number format is `client:port`, so in the example above, "Juno-DS MIDI 1" would be port `28:0`.

**Configure MIDI input:**

Edit the config file:
```bash
sudo nano /opt/sketchatone/configs/config.json
```

Add or update the `midi_input_id`:
```json
{
  "midi": {
    "midi_output_id": 0,
    "midi_input_id": 0,  // Set to your MIDI input port number
    "midi_input_exclude": [
      "Midi Through",
      "RtMidi"
    ]
  }
}
```

**Restart the service:**
```bash
sudo systemctl restart sketchatone
```

**View logs to verify connection:**
```bash
# Follow logs in real-time
sudo journalctl -u sketchatone -f

# Look for lines like:
# [RtMidi] Available MIDI input ports:
# [RtMidi]   0: Juno-DS MIDI 1
# ✓ MIDI input: Juno-DS MIDI 1
```

**Tip:** If you want to listen to **all** MIDI input ports (discovery mode), set `midi_input_id` to `null`:
```json
"midi_input_id": null
```

---

## Installation Issues

### python-rtmidi Installation Fails

**Symptoms:**
- Error during `apt install ./sketchatone-*.deb`
- Message: "python-rtmidi install failed"

**Solutions:**

The installer now tries multiple methods automatically:
1. First tries `apt install python3-rtmidi` (pre-compiled)
2. Falls back to `pip install python-rtmidi` (compiles from source)

If both fail:

```bash
# Install build dependencies
sudo apt-get install -y python3-dev build-essential libasound2-dev

# Try manual install
pip3 install python-rtmidi
```

---

## Performance Issues

### High Latency / Sluggish Response

**Causes:**
- `midiInterMessageDelay` set too high
- System under heavy load
- USB issues

**Solutions:**

1. **Reduce inter-message delay:**
   ```json
   {
     "midi": {
       "midiInterMessageDelay": 0  // Remove delay if notes aren't sticking
     }
   }
   ```

2. **Check system load:**
   ```bash
   top
   # Look for high CPU usage
   ```

3. **Use JACK on Zynthian:**
   - JACK provides lower latency than ALSA
   - Set `"midi_output_backend": "jack"`

---

## Viewing Logs

Since Sketchatone runs as a systemd service, you can view logs using `journalctl`:

```bash
# View recent logs
sudo journalctl -u sketchatone

# Follow logs in real-time (like tail -f)
sudo journalctl -u sketchatone -f

# View logs since last boot
sudo journalctl -u sketchatone -b

# View last 50 lines
sudo journalctl -u sketchatone -n 50

# View logs with timestamps
sudo journalctl -u sketchatone --since "5 minutes ago"
```

**Check service status:**
```bash
sudo systemctl status sketchatone
```

This shows whether the service is running, recent log entries, and any errors.

---

## See Also

- **[Configuration Settings](/about/configuration-settings/)** - Complete settings reference
- **[Getting Started](/about/getting-started/)** - Initial setup guide
- **[JACK MIDI](/about/jack-midi/)** - JACK backend configuration

