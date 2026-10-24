---
layout: guide.njk
title: Connecting a synth or DAW
description: Sketchatone sends MIDI notes. Your synth or DAW turns them into sound.
chapter: 03 / MIDI
art: midi
artDescription: A tablet sends MIDI to a synthesizer
nextTitle: What you'll need for your setup
nextLabel: Setup ideas
nextUrl: /playing/assemble/
---
## Your synth makes the sound

Sketchatone is a MIDI controller, not a synthesizer. It doesn't make sound on its own. Instead, it tells your synth or digital audio workstation which notes to play and how to play them.

A guitar patch, a harp, or a short synth tone is a good place to start. Try a few patches and see what works. You don't have to stick to sounds you'd normally strum.

## Choose a MIDI output

Run Sketchatone on your computer or Raspberry Pi, connect your tablet, and choose a MIDI destination. In your DAW, select that MIDI input on an instrument track. With a hardware synth, route the output to the connected device.

You can choose the destination device and MIDI channel to fit your setup. The [first-run setup guide](/about/getting-started/) walks through the connection, and the [dashboard guide](/about/dashboard/) helps you find the controls.

Using a Linux audio setup? There are separate guides for [JACK MIDI](/about/jack-midi/) and [using a Raspberry Pi as a USB MIDI controller](/about/usb-midi-gadget/).

## Send more than just notes

Crossing a string starts a note. Sketchatone releases it after a set time, or uses pressure, tilt, or position to control how long it lasts.

You can also use those pen inputs to control note velocity and pitch bend. Try pressure for louder or softer notes and vertical position for bends. Your synth patch needs to respond to those MIDI messages too.

The reference has more detail on [note length](/about/note-duration/), [note velocity](/about/note-velocity/), and [pitch bend](/about/pitch-bend/).

## Use MIDI input to choose chords

Sketchatone can receive notes as well as send them. Connect a MIDI keyboard to choose your strumming chord directly from the keys. The [chord guide](/playing/chords/#two-hands-one-instrument) explains how you can use the keyboard and tablet together.