---
title: Introduction
description: Transform your graphics tablet into an expressive MIDI strumming controller
---

# Sketchatone

Hi from Ben! I'm the author of Sketchatone. This project was inpsired by all the guitar strumming in my favorite music I can't do as a keyboard player.
I almost bought the re-release of the Suzuki Omnichord, but at $1000 I thought I might like to do something a bit more DIY.
When I was thinking of ways to make this work, the ordinary drawing tablet popped into my mind as the perfect controller. There are tons on the market
now and they're really inexpensive!

Anyway, I wanted to add a personal note here because this project is largely built with AI coding tools, and the documentation is also created by AI.
Its way more thorough than I'd ever have the patience for, and as this is a side project I really do appreciate the help. But at the same time it can be 
super wordy (and hopefully not wrong).

Either way, there are almost too many configuration options and features to document, so I think as I start playing with this more myself, I'll probably simplify these docs
to more standard use-cases.

For now though, its seems pretty fun to play with. I've tried a few different ways that have been working well.

The first is running on a Macbook Pro, and sending MIDI to Ableton Live. Strumming is great, and the buttons on the side of the tablet
work great for chord switching! I'm disappointed that my one tablet (the Huion) uses an actual keyboard interface which requires root access, but
at least it works.

Adding a MIDI keyboard controller on top of this setup means I don't need the side tablet buttons at all to switch chords! In fact, while the MIDI keyboard can
tell the strummer to switch chords to whatever I play, I can assign different MIDI channels and play some thick pads in Ableton with the keyboard MIDI controller while
simultaneously using the same chords to change the strum chords. Its a pretty full sound!

Secondly, this runs on the Raspberry Pi! For one I've got it running on the [Zynthian](https://zynthian.org/). I've put in the effort to make it appear as a "Sketchatone" named
MIDI device on the Zythian, which means it can run in multitimbral mode and the above trick of using another MIDI controller to both play the block chord on one track and switch
strum notes works well!

Lastly, I had an idea to try running this on a Raspberry Pi 4 with no extras installed, just the normal RPI OS. The idea is to just have it control
a MIDI synth I have over MIDI USB - my Juno DS 88. This works well! It's kind of amazing hearing my guitar patches sound like guitars because I'm strumming them!

This has been a fun project to build, and I hope even more fun to play with. Again it's a side project, so there will probably be issues.
And don't go running out to buy a drawing tablet just for this before you know what you're getting into. I created another project called [Blankslate](https://github.com/bengfarrell/blankslate) to
read and create tablet configurations to use in this project. Ideally, you could buy a tablet, and configure with that tool and it would work. But, I've only done this with two tablets so far, so this is definitely
going to be a "wait and see" how this goes scenario.

That said, the [XP Pen Deco 640](https://www.amazon.com/Deco-640-Sensitivity-Battery-Free-Designing/dp/B0D6XZF9N4/ref=sr_1_1?crid=1QT60WWQ1ANSQ&dib=eyJ2IjoiMSJ9.Aueq6JTmdMyj52fBxsLVtYBcCZ0kU6jQZmy2KvarfJpdkrf_bka6_T1-QoIEExZVYxmw--BqeAc1VWFJ0ZbTOrmSuLREgbtu4SH9BAcNmDBjFYStFq5iz8LzK8oErNY7WVVHYilEb9wFiIdk53_vdpmicYNWIeTG12y0DcySLFf__9zErRC7sqg5uEYFGwecWjRBK2BOkg1TdQSgLGP4kCR-yD1iB8SAvk7qWrRZ6FY.DJHualLy3DNoOye9friyB930lUcpUtWPY8ddd7oeSbI&dib_tag=se&keywords=XP+Pen+deco+640&qid=1771825273&sprefix=xp+pen+deco+640%2Caps%2C190&sr=8-1) 
is a great one to get started with. The configuration is already included with this project, the side buttons don't require elevated permissions, and it's only $30!

If you end up trying this project out, I hope you have fun playing!


### Key Features

- **Strum chords** by drawing across the tablet surface
- **Pressure-sensitive velocity** - press harder for louder notes
- **Tilt-controlled parameters** - angle your pen to control pitch bend or note duration
- **Chord progressions** - map tablet buttons to different chords
- **Stylus button actions** - toggle transpose, repeater, and more
- **Hot-plug support** - connect/disconnect your tablet without restarting

## Architecture

Sketchatone is built on top of [**blankslate**](https://github.com/bengfarrell/blankslate), a universal HID tablet configuration toolkit. Blankslate handles:

- HID device detection and reading
- Hot-plug detection
- Byte-to-value mapping
- Device auto-detection from config files

Sketchatone adds the musical layer:

- Strummer logic (converting position to note triggers)
- MIDI output (rtmidi and JACK backends)
- Parameter mappings (pressure → velocity, tilt → pitch bend, etc.)
- Note repeater and transpose features

## Implementations

Sketchatone is available in two implementations:

| Implementation | Best For |
|----------------|----------|
| **Node.js/TypeScript** | macOS, Windows, web integration |
| **Python** | Linux, Zynthian, JACK MIDI |

Both implementations share the same configuration format and feature set, with Python additionally supporting JACK MIDI for professional Linux audio systems.

## Getting Started

Ready to turn your tablet into a musical instrument?

1. **[Getting Started](/about/getting-started/)** - Installation and first run
2. **[Configuration](/about/configuration-settings/)** - Understanding config files
3. **[Strumming](/about/strumming/)** - How strumming works

## Requirements

- A graphics tablet with HID support (Wacom, XP-Pen, Huion, etc.)
- Node.js 18+ (for TypeScript version) or Python 3.10+ (for Python version)
- A MIDI-capable application (DAW, synthesizer, etc.)
