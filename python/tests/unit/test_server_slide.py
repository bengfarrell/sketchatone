"""
Tests for slide-mode wiring in StrummerWebSocketServer._handle_slide.

Verifies that Slider events are routed to the MIDI backend as the
correct sequence of note_on / pitch_bend / note_off messages and that
StrumEventData is emitted on the event bus for visualizers.
"""

from sketchatone.cli.server import (
    StrummerWebSocketServer,
    StrummerEventBus,
)
from sketchatone.models import MidiStrummerConfig
from sketchatone.models.note import NoteObject
from sketchatone.strummer import Slider
from tests.mocks.mock_midi_backend import MockMidiBackend


def _make_server(notes=None, max_bend_semitones=2.0, pressure_threshold=0.1):
    """Build a minimal server instance bypassing the heavy __init__."""
    server = StrummerWebSocketServer.__new__(StrummerWebSocketServer)
    server.config = MidiStrummerConfig()
    server.config.strummer.mode = 'slide'
    server.config.strummer.slide.max_bend_semitones = max_bend_semitones
    server.config.strummer.slide.pressure_threshold = pressure_threshold

    backend = MockMidiBackend(channel=0)
    backend.connect()
    server.backend = backend

    server.event_bus = StrummerEventBus(throttle_ms=0)

    server.slider = Slider()
    server.slider.configure(pressure_threshold, max_bend_semitones)
    server.slider.update_bounds(1.0, 1.0)
    server.slider.notes = notes or [
        NoteObject(notation='C', octave=4, secondary=False),
        NoteObject(notation='E', octave=4, secondary=False),
        NoteObject(notation='G', octave=4, secondary=False),
    ]

    server.slide_active_note = None
    server.last_slide_modulation_value = None
    server.notes_played = 0
    return server, backend


class TestHandleSlide:
    """Test the _handle_slide method."""

    def test_pen_down_sends_pitch_bend_then_note_on(self):
        """Pen-down on a string should emit pitch_bend then note_on."""
        server, backend = _make_server()

        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)

        msgs = backend.get_messages()
        assert len(msgs) >= 2
        assert msgs[0].type == 'pitch_bend'
        assert msgs[1].type == 'note_on'
        assert msgs[1].note.notation == 'C'
        assert msgs[1].note.octave == 4
        assert msgs[1].velocity > 0
        assert server.slide_active_note is not None
        assert server.slide_active_note.notation == 'C'
        assert server.notes_played == 1

    def test_pen_move_within_string_sends_pitch_bend_only(self):
        """Moving while held but staying inside the same string slot should emit
        pitch_bend updates only — no retrigger / note_on."""
        server, backend = _make_server()
        # Disable pressure modulation so only pitch bend is expected.
        server.config.strummer.slide.pressure_modulation.type = 'none'

        # Pen down on C (string_width = 1/3, so C occupies x in [0, 1/3))
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        backend.clear_messages()

        # Move within C's slot toward the C/E boundary (1.5/6 = 0.25, still in C)
        server._handle_slide(slide_x=1.5 / 6.0, pressure=0.5, raw_x=0.5)

        msgs = backend.get_messages()
        assert all(m.type == 'pitch_bend' for m in msgs)
        assert len(msgs) >= 1
        # Still the same active note
        assert server.slide_active_note.notation == 'C'

    def test_pen_lift_sends_note_off_and_resets_bend(self):
        """Pen-up should emit note_off for the held note and reset bend to 0."""
        server, backend = _make_server()

        # Pen down
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        held_note = server.slide_active_note
        assert held_note is not None
        backend.clear_messages()

        # Pen up (pressure below threshold)
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.0, raw_x=0.5)

        msgs = backend.get_messages()
        types = [m.type for m in msgs]
        assert 'note_off' in types
        note_off_msg = next(m for m in msgs if m.type == 'note_off')
        assert note_off_msg.note.notation == held_note.notation
        assert note_off_msg.note.octave == held_note.octave
        # Bend reset to 0
        bend_msgs = [m for m in msgs if m.type == 'pitch_bend']
        assert bend_msgs and bend_msgs[-1].bend_value == 0.0
        assert server.slide_active_note is None

    def test_bend_clamped_to_max(self):
        """Bend value sent to backend should be clamped to [-1, 1]."""
        server, backend = _make_server(max_bend_semitones=2.0)

        # Pen down between C (anchor) and E (next string, +4 semitones).
        # At slide_x = 1.5/6 the bend is half-way to E ~ +2 semitones,
        # which divided by max_bend=2 yields ~1.0 (clamped).
        server._handle_slide(slide_x=1.5 / 6.0, pressure=0.5, raw_x=0.5)

        bend_msgs = [m for m in backend.get_messages() if m.type == 'pitch_bend']
        assert bend_msgs
        for m in bend_msgs:
            assert -1.0 <= m.bend_value <= 1.0

    def test_strum_event_emitted_on_slide_on(self):
        """A StrumEventData should be emitted on the event bus for slide_on."""
        server, backend = _make_server()

        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.42)

        buffered = server.event_bus._buffer.strum
        assert buffered is not None
        assert buffered.type == 'slide_on'
        assert buffered.x == 0.42
        assert buffered.pressure == 0.5
        assert len(buffered.notes) == 1
        assert buffered.notes[0].name == 'C'
        assert buffered.notes[0].octave == 4

    def test_no_backend_does_not_crash(self):
        """Slide events without a backend should be no-ops (no exception)."""
        server, _ = _make_server()
        server.backend = None

        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.0, raw_x=0.5)
        # No assertion needed beyond not raising

    def test_crossing_string_does_not_retrigger(self):
        """Sliding across string slots holds the original note — only
        pitch_bend messages should be emitted, never note_off / note_on."""
        server, backend = _make_server(max_bend_semitones=24.0)
        server.config.strummer.slide.pressure_modulation.type = 'none'

        # Pen down on C
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.6, raw_x=0.5)
        assert server.slide_active_note.notation == 'C'
        backend.clear_messages()

        # Drag through E and into G's slot.
        server._handle_slide(slide_x=3.0 / 6.0, pressure=0.6, raw_x=0.5)
        server._handle_slide(slide_x=5.0 / 6.0, pressure=0.6, raw_x=0.5)

        msgs = backend.get_messages()
        assert msgs, 'expected pitch_bend updates'
        assert all(m.type == 'pitch_bend' for m in msgs)
        # Anchor note is still C
        assert server.slide_active_note.notation == 'C'

    def test_continuous_bend_reaches_neighbor_pitch_at_neighbor_center(self):
        """At the center of an adjacent string slot, the bend offset should
        equal the interval between that string and the anchor."""
        server, _ = _make_server(max_bend_semitones=24.0)

        # Pen down on C (center 1/6); then move to E's center (3/6 = 0.5)
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        server._handle_slide(slide_x=3.0 / 6.0, pressure=0.5, raw_x=0.5)
        assert server.slider.last_bend_semitones == 4.0  # E - C

        # And to G's center (5/6); G - C = 7 semis
        server._handle_slide(slide_x=5.0 / 6.0, pressure=0.5, raw_x=0.5)
        assert server.slider.last_bend_semitones == 7.0

    def test_held_bend_clamped_to_max_bend_semitones(self):
        """The reported bend never exceeds ±max_bend_semitones, even with
        very wide string intervals."""
        # Two strings an octave apart; max_bend kept small to force the clamp.
        server, _ = _make_server(
            notes=[
                NoteObject(notation='C', octave=4, secondary=False),
                NoteObject(notation='C', octave=5, secondary=False),
            ],
            max_bend_semitones=2.0,
        )

        server._handle_slide(slide_x=0.1, pressure=0.5, raw_x=0.5)
        server._handle_slide(slide_x=0.9, pressure=0.5, raw_x=0.5)
        assert abs(server.slider.last_bend_semitones) <= 2.0 + 1e-9
        assert server.slider.last_bend_semitones == 2.0


class TestSlidePressureModulation:
    """Test pressure modulation routing in _handle_slide."""

    def test_aftertouch_emitted_on_slide_on_and_update(self):
        """Default config (aftertouch) emits aftertouch on slide_on and slide_update."""
        server, backend = _make_server()
        # Default is aftertouch with min=0, max=127
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)

        msgs = backend.get_messages()
        aftertouch_msgs = [m for m in msgs if m.type == 'aftertouch']
        assert len(aftertouch_msgs) == 1
        # pressure=0.5, threshold=0.1 -> normalized ~0.444 -> value ~56
        assert 50 <= aftertouch_msgs[0].value <= 60

        backend.clear_messages()
        server._handle_slide(slide_x=2.0 / 6.0, pressure=0.9, raw_x=0.5)
        aftertouch_msgs = [m for m in backend.get_messages() if m.type == 'aftertouch']
        assert len(aftertouch_msgs) == 1
        # pressure=0.9 -> normalized ~0.889 -> value ~113
        assert 108 <= aftertouch_msgs[0].value <= 117

    def test_cc_emitted_when_configured(self):
        """type='cc' routes pressure to the configured CC number."""
        server, backend = _make_server()
        server.config.strummer.slide.pressure_modulation.type = 'cc'
        server.config.strummer.slide.pressure_modulation.cc_number = 11

        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.55, raw_x=0.5)

        cc_msgs = [m for m in backend.get_messages() if m.type == 'cc']
        assert len(cc_msgs) == 1
        assert cc_msgs[0].cc_number == 11
        assert 0 <= cc_msgs[0].value <= 127
        # No aftertouch when type is 'cc'
        assert not any(m.type == 'aftertouch' for m in backend.get_messages())

    def test_none_emits_no_modulation(self):
        """type='none' suppresses both aftertouch and CC messages."""
        server, backend = _make_server()
        server.config.strummer.slide.pressure_modulation.type = 'none'

        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        server._handle_slide(slide_x=2.0 / 6.0, pressure=0.8, raw_x=0.5)

        msgs = backend.get_messages()
        assert not any(m.type == 'aftertouch' for m in msgs)
        assert not any(m.type == 'cc' for m in msgs)

    def test_modulation_respects_min_max_range(self):
        """min_value/max_value clamp the output range."""
        server, backend = _make_server()
        server.config.strummer.slide.pressure_modulation.type = 'cc'
        server.config.strummer.slide.pressure_modulation.cc_number = 1
        server.config.strummer.slide.pressure_modulation.min_value = 40
        server.config.strummer.slide.pressure_modulation.max_value = 80

        # Pen down at threshold pressure -> should hit min_value
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.1, raw_x=0.5)
        cc_msgs = [m for m in backend.get_messages() if m.type == 'cc']
        assert cc_msgs[0].value == 40

        backend.clear_messages()
        # Move while held with full pressure -> should hit max_value
        server._handle_slide(slide_x=1.5 / 6.0, pressure=1.0, raw_x=0.5)
        cc_msgs = [m for m in backend.get_messages() if m.type == 'cc']
        assert cc_msgs and cc_msgs[-1].value == 80

    def test_dedups_consecutive_identical_values(self):
        """Identical mapped values across slide_updates should only emit once."""
        server, backend = _make_server()
        # Pen down at 0.5 pressure
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        backend.clear_messages()
        # Move slightly with the same pressure -> bend changes but mod value doesn't
        server._handle_slide(slide_x=1.1 / 6.0, pressure=0.5, raw_x=0.5)
        server._handle_slide(slide_x=1.2 / 6.0, pressure=0.5, raw_x=0.5)
        msgs = backend.get_messages()
        aftertouch_msgs = [m for m in msgs if m.type == 'aftertouch']
        assert len(aftertouch_msgs) == 0  # Suppressed because value unchanged
        # Pitch bends still emitted
        assert any(m.type == 'pitch_bend' for m in msgs)

    def test_slide_off_resets_dedup_cache(self):
        """slide_off should clear the dedup cache so a later identical value re-emits."""
        server, backend = _make_server()
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        # Pen lift
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.0, raw_x=0.5)
        assert server.last_slide_modulation_value is None
        backend.clear_messages()
        # New pen-down at the same pressure should emit aftertouch again
        server._handle_slide(slide_x=1.0 / 6.0, pressure=0.5, raw_x=0.5)
        aftertouch_msgs = [m for m in backend.get_messages() if m.type == 'aftertouch']
        assert len(aftertouch_msgs) == 1
