# Sketchatone

🎸 Transform your drawing tablet into an expressive MIDI instrument

Sketchatone converts drawing tablet input into expressive MIDI output, enabling musicians to use tablets as MIDI controllers with strumming, pitch bend, velocity control, and chord progressions.

## Features

- **Strumming Detection**: Natural strum gestures detected from tablet pen movement
- **Pressure-Sensitive Velocity**: Pen pressure controls note velocity and expression
- **Pitch Bend Control**: Y-axis position controls pitch bend for expressive playing
- **Configurable Chords**: Support for various chord types and progressions
- **MIDI Output**: Works with any MIDI-compatible software or hardware
- **WebSocket Server**: Real-time event streaming for web-based interfaces
- **Cross-Platform**: Supports macOS, Linux (including Raspberry Pi), and Windows

## Installation

### macOS
Download the latest `sketchatone-osx-<version>.zip` from releases, extract, and run `Sketchatone.app`

### Linux / Raspberry Pi
```bash
# With install-sketchatone.sh alongside sketchatone-<version>-pi-bundle.tar.gz:
sudo ./install-sketchatone.sh

# Or include the optional native display UI:
sudo ./install-sketchatone.sh --with-ui --appliance

# Run
sketchatone
```

#### Optional Raspberry Pi Setup

The initial appliance target is **64-bit Raspberry Pi OS Lite Bookworm with its
stock Python 3.11**. Newer stock Python versions are accepted by the installer,
but are not a substitute for confirming compatibility on that OS release.
Use Raspberry Pi Imager to set a username, hostname, initial Wi-Fi, and SSH.
Internet access is required during installation.

The packages share one private virtual environment using `/usr/bin/python3`:
`/opt/sketchatone/venv`. They do not replace Python
or install dependencies into the OS-managed Python environment. Required
dependency failures stop installation and display the underlying error.

For a dedicated headless Pi, run the guided appliance profile after installation:

```bash
sudo sketchatone-configure --appliance
```

It selects always-on startup and offers USB MIDI gadget and boot trimming.
It uses the Pi's existing OS network connection without asking for Wi-Fi
credentials or changing network settings. Configure Wi-Fi, hotspot fallback,
and USB tethering later in the dashboard's Network panel, or supply
`/etc/sketchatone/network.json` beforehand. An existing network JSON is preserved;
if enabled, it is applied by the service when it starts.
The normal install still defaults to networking off and USB-triggered startup.
Setup changes are confirmed before applying.
Boot changes require a later reboot. Phone tethering permissions and MIDI output
selection remain device-specific.

After installation, run the interactive configuration menu to enable optional features (USB MIDI gadget mode, autostart behavior, boot-time trimming):

```bash
sudo sketchatone-configure
```

The optional **native UI add-on** shares the core backend, presets, and networking.
It adds Kivy/display dependencies only when selected; installing it does not
automatically enable local-display autostart. Configure it through the main
menu or:

```bash
sudo sketchatone-ui-configure
```

The packaged `sketchatone-ui` connects to the existing backend service rather
than starting a second MIDI/tablet process. UI autostart requires always-on
backend mode; removing the UI leaves the headless service and presets intact.

#### Optional Headless Networking

The Python web server can manage Wi-Fi through Linux NetworkManager. This is
**off by default** and leaves desktop networking untouched. The packaged webapp
service uses `/etc/sketchatone/network.json`, separate from musical presets.
Open the dashboard's **Network** panel to configure and explicitly apply:

- An ordered list of Wi-Fi networks to try, each with a connection timeout.
- A password-protected fallback hotspot if none connect.
- Independent USB phone tethering, which can coexist with Wi-Fi.

For source/manual launches, opt in to the settings file explicitly:

```bash
sudo python3 -m sketchatone.cli.server -c public/configs/default.json \
  --poll 2000 --network-config /etc/sketchatone/network.json
```

NetworkManager must already be installed and running, and the process needs
permission to manage system connections. It is not installed or enabled
automatically.

For networking and dashboard access from boot, even without a tablet, choose
**always-on** in `sudo sketchatone-configure`. USB-triggered mode only runs the
manager while the Sketchatone service is running.

Network changes can disconnect the browser. Join the selected Wi-Fi network or
the fallback hotspot and reopen the Pi's address. The default fallback address is
`http://192.168.50.1` when HTTP uses port 80. Hotspot mode stays available until
an explicit apply/retry; it does not periodically evict connected users to scan.

USB tethering uses a **data-capable cable from the Pi's USB-A host port to the
phone**, not the Pi's USB MIDI gadget port. Enable USB tethering on Android, or
Personal Hotspot and trust/pair the Pi on iPhone. iPhone support additionally
requires the OS's `ipheth`, `usbmuxd`, and `libimobiledevice` support. Phone/carrier
restrictions and dashboard access from the tethering phone need device-specific
confirmation. The Pi may charge the phone, increasing power draw.

Use network administration only on trusted networks. Passwords are stored in a
restricted device file and are not returned to browsers or included in musical
preset exports. Dashboard networking controls do not add user authentication.

### From Source
```bash
npm install
npm run build
cd python
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools
pip install -e .
python -m sketchatone.cli.server
```

Python is the primary backend for desktop and appliance use. Node.js and npm
are needed to build the web dashboard from source, not to run a packaged install.
See the [CLI reference](docs-src/about/python-cli.md) for manual launch options.

## Usage

Launch the application and connect your drawing tablet. The server will automatically detect your tablet and start streaming MIDI events.

For detailed documentation, visit the [Sketchatone Documentation](https://github.com/bengfarrell/sketchatone).

## License

**Sketchatone** is licensed under the [Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International License (CC BY-NC-SA 4.0)](https://creativecommons.org/licenses/by-nc-sa/4.0/).

### What This Means

✅ **Free for non-commercial use** - Personal projects, education, research, and open source projects
✅ **Modify and share** - You can adapt and redistribute the code
✅ **Attribution required** - Give credit to the original author
✅ **Share-alike** - Derivatives must use the same license

❌ **Commercial use requires permission** - Contact for commercial licensing

### Commercial Licensing

If you'd like to use Sketchatone in a commercial product or service, please contact:

**Ben Farrell**
📧 ben@benfarrell.com

Commercial licenses are available for businesses and commercial applications.

## Contributing

Contributions are welcome! Please note that any contributions will be licensed under the same CC BY-NC-SA 4.0 license.

## Author

**Ben Farrell**
📧 ben@benfarrell.com

---

Copyright © 2026 Ben Farrell
