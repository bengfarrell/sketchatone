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

## Windows

*Coming soon* - Windows installer

## Linux / Raspberry Pi / Zynthian

Sketchatone provides a `.deb` package installer for Linux systems, with special support for Zynthian and Raspberry Pi.

### Production Installation (Recommended)

The `.deb` package installs Sketchatone system-wide with all dependencies. **No virtual environment needed!**

#### On your development machine (Mac/Linux):

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone

# Install dependencies and build webapp
npm install
npm run build

# Create the Pi installer package
./package-for-pi.sh
```

This creates:
- `dist/sketchatone-X.X.X-deb-pkg.tar.gz` - Package structure
- `dist/install-sketchatone.sh` - Simple installer script

#### On the Raspberry Pi / Zynthian:

```bash
# Copy files to Pi
scp dist/sketchatone-*-deb-pkg.tar.gz dist/install-sketchatone.sh pi@<pi-hostname>:~/

# SSH into the Pi
ssh pi@<pi-hostname>

# Run the installer (that's it!)
sudo ./install-sketchatone.sh
```

The installer will:
1. Extract the package
2. Build the `.deb` file
3. Install to `/opt/sketchatone/`
4. Install all Python dependencies system-wide
5. Configure udev rules for USB auto-start
6. Set up the systemd service

**Your tablet will work immediately when plugged in!**

### Development Installation (Optional)

Only needed if you're developing Sketchatone or need to modify the source code:

```bash
# Clone the repository on the Pi
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python

# Create virtual environment
python3 -m venv venv
source venv/bin/activate

# Install in editable mode
pip install -e .

# Run manually
python -m sketchatone.cli.server -c /path/to/config.json
```

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
2. Re-run the setup script to regenerate udev rules:
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

### Node.js

```bash
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone
npm install
npm run build:cli
npm run midi-strummer
```

### Python

```bash
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone/python
python -m venv venv
source venv/bin/activate
pip install -e .
python -m sketchatone.cli.midi_strummer
```
