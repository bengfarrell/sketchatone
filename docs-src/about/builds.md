---
title: Builds & Installers
description: Pre-built packages and installers for different platforms
---

# Builds & Installers

Pre-built packages are available for various platforms.

## macOS

*Coming soon* - Standalone application bundle

## Windows

*Coming soon* - Windows installer

## Linux / Raspberry Pi / Zynthian

Sketchatone provides a `.deb` package installer for Linux systems, with special support for Zynthian and Raspberry Pi.

### Quick Install (from pre-built package)

```bash
# Download the .deb package (adjust version as needed)
sudo apt install ./sketchatone-1.0.0-linux-armhf.deb

# Configure auto-start mode
sudo sketchatone-setup --mode usb-trigger
```

### Building from Source

If you need to build the installer yourself:

#### On your development machine (Mac/Linux):

```bash
# Clone the repository
git clone https://github.com/bengfarrell/sketchatone.git
cd sketchatone

# Install dependencies and build webapp
npm install
npm run build

# Create the Pi build package
./package-for-pi.sh
```

This creates `dist/sketchatone-X.X.X-pi-build.tar.gz` containing everything needed.

#### On the Raspberry Pi / Zynthian:

```bash
# Copy the package to the Pi
scp dist/sketchatone-*-pi-build.tar.gz pi@<pi-hostname>:~/

# SSH into the Pi
ssh pi@<pi-hostname>

# Extract and enter directory
tar xzf sketchatone-*-pi-build.tar.gz
cd sketchatone-*-pi-build

# Set up Python environment
cd python
python3 -m venv venv
source venv/bin/activate
pip install -e .

# Install blankslate (tablet HID library)
# Clone it first if you haven't: git clone https://github.com/bengfarrell/blankslate.git
pip install -e /path/to/blankslate/python
cd ..

# Build the standalone application
./build-linux.sh

# Create the .deb package
./create-deb.sh

# Install
sudo apt install ./dist/sketchatone-*.deb
```

### Auto-Start Modes

After installation, configure how Sketchatone starts using the setup script:

```bash
sudo sketchatone-setup --mode <mode>
```

| Mode | Description |
|------|-------------|
| `usb-trigger` | **Recommended.** Starts automatically when tablet is plugged in, stops when unplugged. Zero resource usage when tablet is disconnected. |
| `always-on` | Traditional service that starts on boot and runs continuously. |
| `manual` | No auto-start. Run manually with `sketchatone` command. |

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

The setup script automatically generates udev rules from your device config files. These rules are stored at `/etc/udev/rules.d/99-sketchatone.rules`.

#### What the rules do:

1. **HID Permissions** - Allow non-root access to the tablet:
   ```
   SUBSYSTEM=="hidraw", ATTRS{idVendor}=="28bd", ATTRS{idProduct}=="2904", MODE="0666"
   ```

2. **USB Plug Detection** - Start service when tablet is connected:
   ```
   ACTION=="add", SUBSYSTEM=="usb", ATTR{idVendor}=="28bd", ATTR{idProduct}=="2904", TAG+="systemd", ENV{SYSTEMD_WANTS}="sketchatone.service"
   ```

3. **USB Unplug Detection** - Stop service when tablet is disconnected:
   ```
   ACTION=="remove", SUBSYSTEM=="usb", ENV{ID_VENDOR_ID}=="28bd", ENV{ID_MODEL_ID}=="2904", RUN+="/bin/systemctl stop sketchatone.service"
   ```

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
