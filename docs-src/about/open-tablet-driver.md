---
title: OpenTabletDriver
description: How Sketchatone uses OpenTabletDriver tablet definitions to decode raw HID packets from drawing tablets
---

# OpenTabletDriver

Sketchatone uses tablet definition files from the
[OpenTabletDriver](https://opentabletdriver.net/) (OTD) open-source project
to decode raw HID packets from drawing tablets. This page explains what OTD
is, how Sketchatone uses it, and what it means for tablet compatibility.

## What is OpenTabletDriver?

[OpenTabletDriver](https://opentabletdriver.net/) is an open-source,
cross-platform tablet driver with a large community-maintained library of
tablet definitions. Each definition describes the hardware layout of a
specific tablet model — pen specs, digitizer dimensions, button counts, USB
vendor/product IDs, HID report format, and the parser needed to interpret
raw USB packets.

OTD supports hundreds of tablets across 25+ manufacturers including Wacom,
Huion, XP-Pen, Gaomon, Parblo, UGEE, and many others.

## How Sketchatone uses OTD

**Sketchatone does not run the OpenTabletDriver software.** Instead, it
bundles a subset of OTD's JSON tablet definition files and uses them to
interpret raw HID packets directly.

When Sketchatone reads a USB HID packet from a tablet, it uses the matching
OTD definition to know:

- Which bytes carry the pen X/Y position
- Which bytes carry pressure
- Which bytes carry tilt
- Which bits indicate button states
- How to scale raw integer values to normalised 0–1 ranges

This means Sketchatone needs no OS-level tablet driver installed — it talks
directly to the USB HID layer and does its own packet parsing, informed by
the OTD definitions.

## Bundled definitions

Sketchatone ships **~340 device definitions** covering 25+ manufacturers,
sourced from the OTD repository:

| Manufacturer | Notable models |
|---|---|
| **Huion** | Inspiroy series, Kamvas series |
| **XP-Pen** | Deco series, Star series, Artist series |
| **Wacom** | Intuos, Bamboo, CTL/CTH series |
| **Gaomon** | S/M/PD series |
| **Parblo** | Ninos, Intangbo, A-series |
| **UGEE** | M/S/EX series |
| **VEIKK** | A/S/VK series |
| And more… | Artisul, Bosto, Adesso, Genius, Trust, ViewSonic, … |

Definitions live in `python/sketchatone/tablet/otd/configs/` in the source
tree, organised by manufacturer.

### Example definition

```json
{
  "Name": "XP-Pen Deco 640 (IT640)",
  "Specifications": {
    "Digitizer": { "Width": 159.99, "Height": 89.99,
                   "MaxX": 31998,   "MaxY": 17998 },
    "Pen": { "MaxPressure": 16383, "ButtonCount": 2 },
    "AuxiliaryButtons": { "ButtonCount": 8 }
  },
  "DigitizerIdentifiers": [{
    "VendorID": 10429,
    "ProductID": 10500,
    "InputReportLength": 12,
    "ReportParser": "OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenReportParser"
  }]
}
```

`VendorID`/`ProductID` identify the USB device, `InputReportLength` tells
Sketchatone how many bytes to read per HID frame, and `ReportParser` maps to
a Python parser class that knows how to unpack the bytes into pen coordinates,
pressure, and button states.

## Compatibility

In theory, any tablet with an OTD definition in the bundled set should work
with Sketchatone. In practice, compatibility is tested on a small number of
tablets (see the introduction page), so results may vary.

**Tablets known to work well:**

| Tablet | Notes |
|---|---|
| **XP-Pen Deco 640** | Highly recommended starter tablet. Side buttons don't require root. ~$30. |
| **Huion Inspiroy 2 Medium** | Excellent button layout (30+ mappable buttons). Requires `sudo` for button HID access. ~$70. |
| **Huion H640P** | Compact, well-tested on Pi 4. |

### HID access and permissions

Some tablets (Huion in particular) expose hardware buttons through a
**separate keyboard HID interface** rather than the main digitizer interface.
On Linux, accessing this secondary interface requires either running as root
or having appropriate udev rules. The Sketchatone `.deb` installer generates
these rules automatically.

On macOS, tablets that use a separate keyboard HID interface also require
`sudo` (or Accessibility permissions for pynput).

## Adding a tablet not in the bundled set

If your tablet isn't recognised:

1. Check the full [OTD supported devices list](https://opentabletdriver.net/Tablets)
   to confirm OTD supports your tablet.
2. Find the tablet's JSON definition in the
   [OTD repository](https://github.com/OpenTabletDriver/OpenTabletDriver/tree/master/OpenTabletDriver.Configurations/Tablets).
3. Drop the file into `python/sketchatone/tablet/otd/configs/<Manufacturer>/`
   and also add a matching entry to `public/configs/devices/` with your
   tablet's `vendorId` and `productId` so the autostart udev rules cover it.
4. Test and, if it works, consider opening a PR!

## License

The bundled OTD tablet definitions are licensed under the
**[GNU Lesser General Public License v3.0 (LGPL-3.0)](https://www.gnu.org/licenses/lgpl-3.0.html)**,
copyright the OpenTabletDriver contributors. The full license text is included
at `python/sketchatone/tablet/otd/LGPL-3.0.txt` in the source tree and in
all distributed packages.

Sketchatone is not affiliated with the OpenTabletDriver project.
