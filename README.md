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
# Install the .deb package
sudo dpkg -i sketchatone_<version>_all.deb
sudo apt-get install -f  # Install dependencies

# Run
sketchatone
```

### From Source
```bash
npm install
npm run build
npm run server
```

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
