"""
Tests for the MIDI input mapper.

Verifies the 4-way ``midi.input_mode`` mapping (direct / majorScale /
minorScale / autoScale) used to translate held MIDI notes into the
strummer's base note set. Mirror of test/unit/midi-input-mapper.test.ts -
keep in sync.
"""

import pytest

from sketchatone.models.note import Note, NoteObject
from sketchatone.strummer.midi_input_mapper import map_midi_input_to_strummer_notes


def parse(s: str) -> NoteObject:
    return Note.parse_notation(s)


def names(notes):
    return [f'{n.notation}{n.octave}' for n in notes]


class TestEmptyInput:
    @pytest.mark.parametrize('mode', ['direct', 'majorScale', 'minorScale', 'autoScale'])
    def test_returns_none_for_zero_notes(self, mode):
        assert map_midi_input_to_strummer_notes([], mode) is None


class TestDirectMode:
    def test_returns_held_notes_as_pitch_sorted_copy(self):
        result = map_midi_input_to_strummer_notes(
            [parse('G4'), parse('C4'), parse('E4')], 'direct'
        )
        assert result is not None
        assert names(result) == ['C4', 'E4', 'G4']

    def test_returns_single_held_note(self):
        result = map_midi_input_to_strummer_notes([parse('A3')], 'direct')
        assert names(result) == ['A3']


class TestMajorScaleMode:
    def test_builds_c_major_from_lowest_held_note(self):
        result = map_midi_input_to_strummer_notes([parse('C4')], 'majorScale')
        assert names(result) == ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']

    def test_ignores_additional_held_notes(self):
        result = map_midi_input_to_strummer_notes(
            [parse('C4'), parse('Eb4'), parse('G4')], 'majorScale'
        )
        assert names(result) == ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']


class TestMinorScaleMode:
    def test_builds_a_natural_minor_from_lowest_held_note(self):
        result = map_midi_input_to_strummer_notes([parse('A3')], 'minorScale')
        assert names(result) == ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4']

    def test_ignores_additional_held_notes(self):
        result = map_midi_input_to_strummer_notes(
            [parse('A3'), parse('C4'), parse('E4')], 'minorScale'
        )
        assert names(result) == ['A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4']


class TestAutoScaleMode:
    def test_one_note_neutral_set_from_root_no_third(self):
        result = map_midi_input_to_strummer_notes([parse('C4')], 'autoScale')
        # C, D, F, G
        assert names(result) == ['C4', 'D4', 'F4', 'G4']

    def test_one_note_neutral_set_crosses_octaves(self):
        # A4 + intervals 0, 2, 5, 7 -> A4, B4, D5, E5
        result = map_midi_input_to_strummer_notes([parse('A4')], 'autoScale')
        assert names(result) == ['A4', 'B4', 'D5', 'E5']

    def test_two_notes_minor_third_yields_minor_scale(self):
        # C + Eb = minor 3rd -> C minor
        result = map_midi_input_to_strummer_notes(
            [parse('C4'), parse('Eb4')], 'autoScale'
        )
        assert names(result) == ['C4', 'D4', 'D#4', 'F4', 'G4', 'G#4', 'A#4']

    def test_two_notes_major_third_yields_major_scale(self):
        result = map_midi_input_to_strummer_notes(
            [parse('C4'), parse('E4')], 'autoScale'
        )
        assert names(result) == ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']

    def test_two_notes_non_third_interval_defaults_to_major(self):
        # C + G = perfect 5th -> default major (documented as ambiguous)
        result = map_midi_input_to_strummer_notes(
            [parse('C4'), parse('G4')], 'autoScale'
        )
        assert names(result) == ['C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4']

    def test_lowest_note_is_root_regardless_of_input_order(self):
        result = map_midi_input_to_strummer_notes(
            [parse('Eb4'), parse('C4')], 'autoScale'
        )
        # C minor (lowest = C, interval to Eb = 3 semis)
        assert names(result) == ['C4', 'D4', 'D#4', 'F4', 'G4', 'G#4', 'A#4']

    def test_more_than_two_notes_falls_back_to_direct(self):
        held = [parse('C4'), parse('Eb4'), parse('G4'), parse('Bb4')]
        result = map_midi_input_to_strummer_notes(held, 'autoScale')
        # Falls back to direct -> sorted held notes verbatim (notation preserved)
        assert names(result) == ['C4', 'Eb4', 'G4', 'Bb4']


class TestUnknownMode:
    def test_falls_back_to_direct_rather_than_raising(self):
        result = map_midi_input_to_strummer_notes(
            [parse('C4'), parse('E4')], 'someUnknownMode'  # type: ignore[arg-type]
        )
        assert names(result) == ['C4', 'E4']
