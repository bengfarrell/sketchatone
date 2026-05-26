---
title: Kiosk Mode (Raspberry Pi)
description: Auto-start the Sketchatone web dashboard in fullscreen Chromium on boot
---

# Kiosk Mode

Kiosk mode turns a Raspberry Pi running Sketchatone into a dedicated touchscreen appliance: on boot, Chromium opens the web dashboard fullscreen, with no window chrome, address bar, or notifications. It's intended for permanent installations, live performance setups, and demo stations.

Kiosk mode is configured by the `sketchatone-setup-kiosk` helper, which is installed by the `.deb` package described in [Builds & Installers](/about/builds/).

## Requirements

- Raspberry Pi OS **Bookworm or newer** (Pi 4 / Pi 5 recommended)
- The **labwc** Wayland compositor (default on Pi 4 / Pi 5 with Bookworm)
- Sketchatone installed via the `.deb` package, with the `sketchatone` systemd service available

Older LXDE/X11 sessions and `wayfire` are not supported. The setup script checks for `labwc` and exits with an error if it's not present.

## Installing

Run the helper as root:

```bash
sudo sketchatone-setup-kiosk
```

The script will:

1. Confirm you're running labwc.
2. Install Chromium via `apt` (auto-detects `chromium` or `chromium-browser`).
3. Prompt for the kiosk URL (default: `http://localhost`, which matches the default `http_port: 80` in `public/configs/default.json`).
4. Write a `labwc` autostart entry to `~/.config/labwc/autostart` (existing autostart files are backed up).
5. Optionally enable desktop auto-login for the user via `raspi-config`.
6. Ensure the `sketchatone` systemd service is enabled and active (running `sketchatone-setup --mode always-on` if available).
7. Verify the URL is reachable (so you don't reboot into a Chromium connection-error page).
8. Optionally set `gpu_mem=128` in `config.txt` for smoother Chromium rendering.

The autostart entry is wrapped in `# >>> Sketchatone Kiosk >>>` / `# <<< Sketchatone Kiosk <<<` markers so it can be safely added to or removed from an existing `autostart` file without affecting other entries.

After installation you'll be offered an immediate reboot. On next boot, Chromium will open fullscreen on the dashboard URL.

## Testing Without Rebooting

To preview the kiosk on the Pi's local display without rebooting, log out and back in, or run:

```bash
chromium --kiosk --ozone-platform=wayland http://localhost
```

(Use `chromium-browser` instead if that's the binary the script reported during install.)

## Exiting Kiosk Mode Temporarily

While the kiosk is running:

- Switch to a TTY with **Ctrl+Alt+F2**, then run `sudo systemctl restart display-manager` to restart the desktop session.
- Or, if enabled in your keyboard layout, **Ctrl+Alt+Backspace** ends the labwc session.

These are session-level controls and don't change the kiosk configuration — the next reboot will return to kiosk mode.

## Uninstalling

```bash
sudo sketchatone-setup-kiosk --uninstall
```

This removes only the Sketchatone-managed block from `~/.config/labwc/autostart` (and deletes the file entirely if nothing else is left in it). Chromium itself is left installed.

## URL and Server Configuration

Kiosk mode points Chromium at a single URL. By default that's `http://localhost`, which expects the Sketchatone server to be serving HTTP on port 80. That matches the default config shipped at `public/configs/default.json`:

```json
{
  "server": {
    "http_port": 80,
    "ws_port": 8081
  }
}
```

If you change `http_port` (or move the server to a different host), re-run `sudo sketchatone-setup-kiosk` and enter the new URL when prompted.

> **Note:** The kiosk is just a Chromium window pointed at a URL — the server is what actually serves the dashboard. Make sure the `sketchatone` service is configured and running before installing kiosk mode. The setup script does this for you via the `sketchatone-setup --mode always-on` helper.

## Troubleshooting

**Chromium opens but shows a connection error**
The `sketchatone` service isn't reachable at the kiosk URL. Check:

```bash
systemctl status sketchatone --no-pager
sudo journalctl -u sketchatone -n 80 --no-pager
```

A common cause is the service restart-looping because no tablet is connected and no `--poll` interval is configured. See the `device_finding_poll_interval` server setting in [Configuration](/about/configuration-settings/#server) to make the server wait for a tablet instead of exiting.

**`labwc not found` error during install**
You're on an older Raspberry Pi OS release or a non-labwc session. Upgrade to Bookworm or newer; kiosk mode does not support LXDE/X11 or wayfire.

**`No chromium package available in apt`**
Make sure `sudo apt update` succeeds and standard Raspberry Pi OS / Debian repositories are enabled. The script tries both `chromium` and `chromium-browser` package names.

## See Also

- **[Builds & Installers](/about/builds/)** — installing the `.deb` package that ships `sketchatone-setup-kiosk`
- **[Web Dashboard](/about/dashboard/)** — what the kiosk actually displays
- **[Configuration](/about/configuration-settings/#server)** — `http_port`, `ws_port`, and `device_finding_poll_interval`
