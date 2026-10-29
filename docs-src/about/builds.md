---
title: Builds & Installers
description: Pre-built packages and installers for different platforms
---

# Builds & Installers

Pre-built packages are available for various platforms.

## macOS

Sketchatone provides a lightweight macOS application bundle (~11MB) that includes everything needed to run.

### Quick Install

1. Download `Sketchatone.app` from the [releases page](https://github.com/bengfarrell/sketchatone/releases)
2. Drag to `/Applications`
3. Double-click to launch

The app opens Terminal with the server running and automatically opens your browser to the Sketchatone interface.

### For Tablets Requiring Exclusive HID Access

Some tablets (like Huion) require exclusive HID access for hardware button support. Run with sudo:

```bash
sudo /Applications/Sketchatone.app/Contents/MacOS/sketchatone-server
```

Or use the included `Run Sketchatone (sudo).command` file which prompts for your password.

### Building from Source

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone

# Install dependencies
npm install

# Build the macOS app bundle
npm run package:macos
```

This creates `dist/Sketchatone.app` (~11MB) containing:
- Bundled Python virtual environment with all dependencies
- The Sketchatone webapp
- Device configuration files
- App icon

**Requirements for building:**
- Python 3.x
- Node.js
- `librsvg` for icon generation (optional): `brew install librsvg`

### What's Included

The app bundle is self-contained with:
- Python venv with `hidapi`, `websockets`, `python-rtmidi`, and other dependencies
- Pre-built webapp served at `http://localhost:8080`
- WebSocket server at `ws://localhost:8081`
- All device configuration files

No additional Python packages need to be installed on the target system.

## Linux / Raspberry Pi / Zynthian

Sketchatone provides a `.deb` package installer for Linux systems, with special support for Zynthian and Raspberry Pi.

### Production Installation (Recommended)

The `.deb` package installs Sketchatone and creates its private Python virtual
environment automatically. No manual Python setup or alternate interpreter is
needed. The initial appliance target is 64-bit Raspberry Pi OS Lite Bookworm,
using its stock Python 3.11. The installer accepts stock Python 3.11 or newer;
other OS releases still need hardware compatibility confirmation.

Before booting, Raspberry Pi Imager can configure the username, hostname,
initial Wi-Fi connection and SSH. Installation needs internet access to download
dependencies. Node.js and npm are only needed on the build machine, not the Pi.

#### On your development machine (Mac/Linux):

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone

# Install build dependencies
npm install

# Create the Pi installer package (always rebuilds the web dashboard)
./package-for-pi.sh
```

This creates `dist/sketchatone-<version>-pi-bundle.tar.gz`, containing the core
package and optional native UI add-on, plus `dist/install-sketchatone.sh`.
Copy both files together. The same bundle supports both install choices;
Kivy and graphics dependencies are installed only with `--with-ui`.

#### On the Raspberry Pi / Zynthian:

```bash
# From your development machine, copy both generated release files:
scp dist/sketchatone-*-pi-bundle.tar.gz dist/install-sketchatone.sh pi@<pi-hostname>:~/

# SSH into the Pi
ssh pi@<pi-hostname>

# Run the installer alongside the bundle (no manual extraction needed)
sudo ./install-sketchatone.sh --appliance

# Or install the native display UI as well:
sudo ./install-sketchatone.sh --with-ui --appliance
```

The installer will:
1. Extract the package
2. Build the `.deb` file
3. Install to `/opt/sketchatone/`
4. Install all Python dependencies in `/opt/sketchatone/venv`, using the OS interpreter
5. Configure udev rules for USB auto-start
6. Set up the systemd service

With `--appliance`, the helper then opens the guided headless setup: always-on
startup, optional USB MIDI gadget setup, and boot trimming. It asks for confirmation
before applying. Setup leaves the Pi's existing OS Wi-Fi configuration alone and
does not ask for network credentials. Manage Wi-Fi, hotspot fallback, and phone
tethering later in the dashboard's Network panel, or preconfigure
`/etc/sketchatone/network.json`. An existing network JSON is preserved and used
by the service; if management is enabled there, restarting may disconnect SSH.
Any needed reboot is left to you.

Without `--appliance`, the install retains USB-triggered startup and leaves network
management disabled. For direct `.deb` installations or to rerun setup later:

```bash
sudo sketchatone-configure --appliance
```

Set your desired MIDI output in the dashboard. A supported tablet, a working
MIDI destination and device-side phone tethering permissions are still required.
Installation stops on required dependency errors instead of reporting a partial
installation as successful.

### Development Installation (Optional)

Only needed if you're developing Sketchatone or need to modify the source code:

```bash
# Clone the repository on the Pi
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Upgrade pip/setuptools (editable install requires pip >= 21.3, setuptools >= 64)
pip install --upgrade pip setuptools

# Install in editable mode
pip install -e .

# Run manually
python -m sketchatone.cli.server -c /path/to/config.json
```

### Optional Native Pi UI Add-on

Choose `--with-ui` using the same installer to add the native Kivy dashboard,
including on a Pi where the core is already installed. Internally the bundle
contains two Debian packages: `sketchatone` owns the backend, and
`sketchatone-ui` adds display support and depends on the matching core version.
Both share `/opt/sketchatone/venv` and `/opt/sketchatone/configs`; no duplicate
engine or settings directory is created.

Installing display support does not automatically enable kiosk autostart.
The appliance wizard can offer that setup when the add-on is installed, or use:

```bash
sudo sketchatone-ui-configure
```

The packaged native UI attaches to `sketchatone.service`. Both the browser and
local display can be used simultaneously. Enabling UI autostart selects always-on
backend startup; disabling/removing UI autostart leaves the backend and its
tablet permissions intact. Disable UI autostart before switching to USB-triggered
or manual backend startup.

Legacy `/opt/sketchatone-ui` settings are backed up during migration rather than
silently overwriting the core's existing presets.

See **[Native Pi UI](/about/native-ui/)** for usage details.

---

### Post-Install Configuration

After installation, the interactive menu covers autostart mode, USB MIDI gadget mode, and boot-time trimming in one place:

```bash
sudo sketchatone-configure
```

The individual helper commands documented below (`sketchatone-setup`, `sketchatone-setup-usb-gadget`, `sketchatone-boot-trim`) remain available for scripting and advanced use.

### Auto-Start Modes

By default, installation configures **usb-trigger** mode. You can change this behavior:

```bash
sudo sketchatone-setup --mode <mode>
```

| Mode | Description |
|------|-------------|
| `usb-trigger` | **Default.** Starts automatically when tablet is plugged in, stops when unplugged. Zero resource usage when tablet is disconnected. |
| `always-on` | Traditional service that starts on boot and runs continuously. |
| `manual` | No auto-start. Run manually with `sketchatone` command. HID permissions are preserved. |

#### USB-Triggered Mode (Recommended for Zynthian)

This mode uses Linux udev rules to detect when your tablet is plugged in:

```bash
sudo sketchatone-setup --mode usb-trigger
```

**How it works:**
- When you plug in a supported tablet, the service starts automatically
- When you unplug the tablet, the service stops
- Zero CPU/memory usage when the tablet isn't connected
- Perfect for Zynthian where resources matter

#### Checking Status

```bash
# View current configuration
sudo sketchatone-setup --status

# List detected device configs
sudo sketchatone-setup --list-devices

# Check if service is running
systemctl status sketchatone
```

### Understanding udev Rules

The installer automatically generates udev rules from your device config files. These rules are stored at `/etc/udev/rules.d/99-sketchatone.rules`.

#### Why udev rules are required

Some drawing tablets expose their hardware buttons through a **separate keyboard HID interface** rather than the main digitizer interface. On Linux, accessing these HID interfaces requires either:

- Running as root (not recommended)
- Having udev rules that grant permissions to the device

The udev rules generated during installation grant read/write access to **all HID interfaces** for your tablet, ensuring both pen input and hardware buttons work without requiring sudo.

#### What the rules do:

1. **HID Permissions** - Allow non-root access to all tablet interfaces (pen and buttons):
   ```
   SUBSYSTEM=="hidraw", ATTRS{idVendor}=="28bd", ATTRS{idProduct}=="2904", MODE="0666"
   ```

2. **USB Plug Detection** - Start service when tablet is connected (usb-trigger mode only):
   ```
   ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="28bd", ATTR{idProduct}=="2904", TAG+="systemd", ENV{SYSTEMD_WANTS}="sketchatone.service"
   ```

3. **USB Unplug Detection** - Stop service when tablet is disconnected (usb-trigger mode only):
   ```
   ACTION=="remove", SUBSYSTEM=="usb", ENV{ID_VENDOR_ID}=="28bd", ENV{ID_MODEL_ID}=="2904", RUN+="/bin/systemctl stop sketchatone.service"
   ```

#### Disabling auto-start while keeping permissions

If you want to run Sketchatone manually but still need the HID permissions for tablet buttons:

```bash
sudo sketchatone-setup --mode manual
```

This removes the USB plug/unplug detection rules but keeps the HID permission rules intact.

#### Adding a new device:

1. Create a device config JSON in `/opt/sketchatone/configs/devices/` with `vendorId` and `productId` fields
2. Re-run the autostart setup to regenerate udev rules — either interactively via `sudo sketchatone-configure` → **Autostart mode** → **usb-trigger**, or directly:
   ```bash
   sudo sketchatone-setup --mode usb-trigger
   ```

#### Manual udev rule editing:

If you need to customize the rules:

```bash
# Edit the rules file
sudo nano /etc/udev/rules.d/99-sketchatone.rules

# Reload rules after editing
sudo udevadm control --reload-rules
sudo udevadm trigger
```

### Updating Sketchatone

To update to a new version:

1. **On your dev machine:** Bump version in `python/pyproject.toml` and run `./package-for-pi.sh`
2. **Copy to Pi** and build as above
3. **Install the update:**
   ```bash
   sudo apt install ./dist/sketchatone-X.X.X-linux-armhf.deb
   ```

The package manager handles the upgrade seamlessly. Your config file at `/opt/sketchatone/configs/config.json` is preserved.

### Zynthian-Specific Setup

For Zynthian, use the JACK MIDI backend for best integration:

1. Edit `/opt/sketchatone/configs/config.json`:
   ```json
   {
     "midi": {
       "midi_output_backend": "jack",
       "jack_client_name": "sketchatone",
       "jack_auto_connect": "chain0"
     },
     "server": {
       "device": "devices",
       "http_port": null,
       "ws_port": null
     }
   }
   ```

2. Setting `http_port` and `ws_port` to `null` disables the web servers for minimal resource usage.

See **[JACK MIDI](/about/jack-midi/)** for detailed Zynthian configuration.

### USB MIDI Gadget Mode (Optional)

For users who want to connect the Raspberry Pi directly to MIDI hardware that supports power over the USB MIDI connection (like the Akai MPC One+):

The Pi can be configured as a **USB MIDI device**, allowing it to communicate and be powered through a single USB-C cable. This eliminates the need for external MIDI adapters or a separate data and power cord.

See **[USB MIDI Gadget Setup](/about/usb-midi-gadget/)** for complete instructions on:
- Enabling USB gadget mode on Raspberry Pi 4
- Configuring the `g_midi` kernel module
- Routing Sketchatone MIDI output through the USB gadget port
- Connecting directly to MIDI hardware

> **Note:** This is an optional advanced configuration. Standard MIDI adapters work perfectly fine for most use cases.

## Running from Source (Development)

For development or platforms without installers:

Python is the primary backend for desktop and appliance use. Build the browser
dashboard from the repository root, then install the backend in a virtual environment:

```bash
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone
npm install
npm run build
cd python
python3 -m venv venv
source venv/bin/activate
pip install --upgrade pip setuptools
pip install -e .
python -m sketchatone.cli.server
```

For MIDI-only operation, use `python -m sketchatone.cli.midi_strummer`.
See the [Python CLI reference](/about/python-cli/) for additional launch options.
