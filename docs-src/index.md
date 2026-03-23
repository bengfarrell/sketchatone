---
title: Introduction
description: Transform your graphics tablet into an expressive MIDI strumming controller
---

# Sketchatone

Hi from Ben! I'm the author of Sketchatone. This project was inpsired by all the guitar strumming in my favorite music that I can't do as a keyboard player.
Products like the Suzuki Omnichord were tempting, but at $1000 I thought I might like to do something a bit more DIY.
When I was thinking of ways to make this work, the ordinary drawing tablet popped into my mind as the perfect controller. There are tons on the market
now and they're really inexpensive!

Anyway, I wanted to add a personal note here because this project is largely built with AI coding tools, as well as the rest of the documentation.
There are almost too many configuration options and features to document and test, so AI was a big help - especially getting this working in Python which I'm not 
as familiar with as Node.js, the other language I started with and continue to support in this project.

Perhaps as I use it more, I might pare down some of the features that I find I don't use, but for now though, its seems pretty fun to play with. 

I've been exploring running this project a few different ways.

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
This also has proven to work on my MPC One+, but in a different way. We can put a Rasperry Pi into MIDI controller mode, such that the same USB-C port that 
powers the Rasperry Pi also acts like a pure MIDI connection.

This has been a fun project to build, and I hope even more fun to play with. Again it's a side project, so there will probably be issues.
And don't go running out to buy a drawing tablet just for this before you know what you're getting into. I created another project called [Blankslate](https://github.com/bengfarrell/blankslate) to
read and create tablet configurations to use in this project. Ideally, you could buy a (HID compatible) tablet, and configure with that tool and it would work. But, I've only done this with two tablets so far, so this is definitely
going to be a "wait and see how this goes" scenario.

That said, the [XP Pen Deco 640](https://www.amazon.com/Deco-640-Sensitivity-Battery-Free-Designing/dp/B0D6XZF9N4/ref=sr_1_1?crid=1QT60WWQ1ANSQ&dib=eyJ2IjoiMSJ9.Aueq6JTmdMyj52fBxsLVtYBcCZ0kU6jQZmy2KvarfJpdkrf_bka6_T1-QoIEExZVYxmw--BqeAc1VWFJ0ZbTOrmSuLREgbtu4SH9BAcNmDBjFYStFq5iz8LzK8oErNY7WVVHYilEb9wFiIdk53_vdpmicYNWIeTG12y0DcySLFf__9zErRC7sqg5uEYFGwecWjRBK2BOkg1TdQSgLGP4kCR-yD1iB8SAvk7qWrRZ6FY.DJHualLy3DNoOye9friyB930lUcpUtWPY8ddd7oeSbI&dib_tag=se&keywords=XP+Pen+deco+640&qid=1771825273&sprefix=xp+pen+deco+640%2Caps%2C190&sr=8-1) 
is a great one to get started with. The configuration is already included with this project, the side buttons don't require elevated permissions, and it's only $30!

The [Huion Inspiroy 2 Medium](amazon.com/HUION-Inspiroy-Medium-Battery-Free-Black/dp/B0BNQ6QM64/ref=sr_1_1_sspa?adgrpid=188085955842&dib=eyJ2IjoiMSJ9.myucJimF69Ru9FoetZf-zEtSrHLwMWzHD_PeQYQaRfkGvzKi4AXwynIhbMHdcmgye5Rcv_VMzvuvO1DXqQUg74kDiVSBfg1uPPUUr2Ap1JUrJJigCHjxCtO7MIu5MEgcDuN3maAsX1s5D0uYuGUqrjsFKb3VrGQsMtBXgNw3moRvVthWEtXw6mrPdbyedalldjK5P8Dd4hjCW-yEpmaTy-eWpRKyJWc3ZO8tidGwPTQ.xDB1HqikpeGgwz_datLsZne57yTabYEPvOrb_-oWefE&dib_tag=se&hvadid=779543893087&hvdev=c&hvexpln=0&hvlocphy=1014230&hvnetw=g&hvocijid=4454177273143324648--&hvqmt=e&hvrand=4454177273143324648&hvtargid=kwd-1947280496101&hydadcr=921_1015320465_2340533&keywords=huion+inspiroy+2&mcid=700c58acd2b93c72855ad6d5f964d951&qid=1774217321&sr=8-1-spons&sp_csd=d2lkZ2V0TmFtZT1zcF9hdGY&psc=1) is also a great tablet, but it's a little pricier at $70. For me it's worth it though. Between all of the different button modes, we're 
looking at around 30 tactile feeling buttons to map to different chords and actions!

If you end up trying this project out, I hope you have fun playing!

<iframe width="560" height="315" src="https://www.youtube.com/embed/iXwvTR0crbg?si=UvxQ8YH8_fonOQxT" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

<iframe width="560" height="315" src="https://www.youtube.com/embed/4iBmuIM1GNM?si=uNVCOMxTt8Sblrlt" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>

<iframe width="560" height="315" src="https://www.youtube.com/embed/_h9KkgAcsuk?si=XElALXI6GTfSWq66" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>


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
| **Node.js/TypeScript** | macOS, web integration |
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
