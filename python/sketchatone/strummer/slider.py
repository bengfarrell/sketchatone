"""
Slider

Trombone-style note controller. Unlike the Strummer (which plucks discrete
notes when crossing string boundaries), the Slider holds a single note for
the entire pen-down stroke and continuously bends its pitch as the pen
moves across the tablet. The bend is computed by piecewise-linear
interpolation between the actual MIDI values of the strings in the layout,
so the pen sounding pitch matches the string it is hovering over even when
that spans multiple octaves.

Events emitted:
    - 'slide_on':       pen pressed down; data: {type, note, velocity, bend_semitones}
    - 'slide_update':   bend/pressure changed while held; data: {type, note, bend_semitones, pressure}
    - 'slide_off':      pen lifted; data: {type}
    - 'notes_changed':  forwarded from the underlying StringLayout

Pitch bend is returned as a signed semitone offset from the anchor note
(``bend_semitones``), capped at ``max_bend_semitones``. Converting that to
a 14-bit MIDI pitch-bend value is left to the consumer, which scales by
the synth's configured bend range (same ``max_bend_semitones``).
"""

from typing import List, Optional, Dict, Any

from ..models.note import NoteObject
from ..utils.event_emitter import EventEmitter
from .string_layout import StringLayout


# Minimum changes worth emitting a slide_update for (avoids flooding consumers).
_BEND_EPSILON = 0.001       # semitones
_PRESSURE_EPSILON = 0.005   # normalized pressure


def pressure_to_modulation_value(
    pressure: float,
    pressure_threshold: float,
    min_value: int,
    max_value: int,
) -> int:
    """
    Map a pen pressure (0-1) to a 7-bit MIDI value (0-127) for aftertouch
    or Control Change, using the same threshold the Slider uses to detect
    pen-down. ``pressure == pressure_threshold`` yields ``min_value`` and
    ``pressure == 1.0`` yields ``max_value``.
    """
    denom = 1.0 - pressure_threshold
    if denom <= 0:
        normalized = 1.0
    else:
        normalized = (pressure - pressure_threshold) / denom
    normalized = max(0.0, min(1.0, normalized))
    return max(0, min(127, int(round(min_value + normalized * (max_value - min_value)))))


class Slider(EventEmitter):
    """
    Trombone-style controller built on top of a StringLayout.

    A note is anchored on pen-down and held for the entire stroke. The
    pitch is bent continuously across the whole tablet, interpolated
    piecewise-linearly between the MIDI values of adjacent strings so the
    sounding pitch matches the string under the pen.

    ``max_bend_semitones`` must match the synth's configured pitch-bend
    range; it is used both as the clamp on the reported bend and as the
    scaling factor when the consumer converts the offset to a 14-bit
    pitch-bend value.
    """

    def __init__(self):
        super().__init__()
        self.layout = StringLayout()
        self.layout.on('notes_changed', self._on_layout_notes_changed)

        self.pressure_threshold: float = 0.1
        self.max_bend_semitones: float = 24.0

        # State
        self.active_index: int = -1
        self.last_pressure: float = 0.0
        self.last_bend_semitones: float = 0.0

    def _on_layout_notes_changed(self) -> None:
        self.emit('notes_changed')

    @property
    def notes(self) -> List[NoteObject]:
        return self.layout.notes

    @notes.setter
    def notes(self, notes: List[NoteObject]) -> None:
        self.layout.notes = notes

    def get_notes_state(self) -> Dict[str, Any]:
        return self.layout.get_notes_state()

    def update_bounds(self, width: float, height: float) -> None:
        self.layout.update_bounds(width, height)

    def configure(self, pressure_threshold: float = 0.1, max_bend_semitones: float = 24.0) -> None:
        """Configure slider parameters."""
        self.pressure_threshold = pressure_threshold
        self.max_bend_semitones = max_bend_semitones

    def clear(self) -> None:
        """Reset transient state (does not clear notes or bounds)."""
        self.active_index = -1
        self.last_pressure = 0.0
        self.last_bend_semitones = 0.0

    def slide(self, x: float, pressure: float) -> Optional[Dict[str, Any]]:
        """
        Process slider input.

        Args:
            x: X position on the tablet (0 to width)
            pressure: Pen pressure (0 to 1)

        Returns:
            A slide_on / slide_update / slide_off event dict, or None if
            nothing meaningful changed.
        """
        notes = self.layout.notes
        if len(notes) == 0:
            return None

        has_pressure = pressure >= self.pressure_threshold
        was_pressed = self.last_pressure >= self.pressure_threshold

        # Pen lifted
        if was_pressed and not has_pressure:
            self.last_pressure = pressure
            if self.active_index == -1:
                return None
            self.active_index = -1
            self.last_bend_semitones = 0.0
            return {'type': 'slide_off'}

        # Pen pressed (first contact)
        if not was_pressed and has_pressure:
            index = self.layout.index_at(x)
            if index < 0:
                self.last_pressure = pressure
                return None
            self.active_index = index
            self.last_pressure = pressure
            velocity = self._pressure_to_velocity(pressure)
            bend = self._bend_semitones_for(x)
            self.last_bend_semitones = bend
            return {
                'type': 'slide_on',
                'note': notes[index],
                'velocity': velocity,
                'bend_semitones': bend,
            }

        # Held — anchor note stays put for the whole stroke; pitch bends
        # continuously across the full tablet via piecewise interpolation.
        if has_pressure and self.active_index != -1:
            bend = self._bend_semitones_for(x)
            pressure_changed = abs(pressure - self.last_pressure) > _PRESSURE_EPSILON
            bend_changed = abs(bend - self.last_bend_semitones) > _BEND_EPSILON
            self.last_pressure = pressure
            if pressure_changed or bend_changed:
                self.last_bend_semitones = bend
                return {
                    'type': 'slide_update',
                    'note': notes[self.active_index],
                    'bend_semitones': bend,
                    'pressure': pressure,
                }
            return None

        self.last_pressure = pressure
        return None


    def _pressure_to_velocity(self, pressure: float) -> int:
        """Map pressure (threshold..1.0) to MIDI velocity (20..127)."""
        denom = 1.0 - self.pressure_threshold
        if denom <= 0:
            return 127
        normalized = (pressure - self.pressure_threshold) / denom
        normalized = max(0.0, min(1.0, normalized))
        return max(20, min(127, int(20 + normalized * 107)))

    def _bend_semitones_for(self, x: float) -> float:
        """
        Compute the pitch-bend offset (in semitones) from the anchor note
        for the given x position. Uses piecewise-linear interpolation
        between adjacent string MIDI values so the sounding pitch matches
        the string under the pen. Clamps to ``±max_bend_semitones``.
        """
        if self.active_index == -1:
            return 0.0
        sw = self.layout.string_width
        if sw <= 0:
            return 0.0

        notes = self.layout.notes
        n = len(notes)

        # Fractional position in "string-center" units (string i has center i).
        p = x / sw - 0.5
        if p <= 0:
            midi_at_x = float(notes[0].to_midi())
        elif p >= n - 1:
            midi_at_x = float(notes[n - 1].to_midi())
        else:
            lo = int(p)
            hi = lo + 1
            frac = p - lo
            midi_at_x = (
                notes[lo].to_midi() + frac * (notes[hi].to_midi() - notes[lo].to_midi())
            )

        bend = midi_at_x - notes[self.active_index].to_midi()
        return max(-self.max_bend_semitones, min(self.max_bend_semitones, bend))
