"""Chord-mode entry normalization shared by runtime actions and the UI."""

import math
from typing import Any, Dict, Optional

QUALITY_SUFFIXES = {
    'major': '',
    'minor': 'm',
    'diminished': 'dim',
    'augmented': 'aug',
    'sus2': 'sus2',
    'sus4': 'sus4',
    'power': '5',
}

EXTENSION_SUFFIXES = {
    'none': '',
    '6': '6',
    '7': '7',
    'maj7': 'maj7',
    '9': '9',
    'maj9': 'maj9',
    'add9': 'add9',
}

MAJOR_SCALE_SEMITONES = (0, 2, 4, 5, 7, 9, 11)


def _is_integer(value: Any) -> bool:
    return (
        isinstance(value, int) and not isinstance(value, bool)
    ) or (
        isinstance(value, float) and math.isfinite(value) and value.is_integer()
    )


def resolve_chord_mode_entry(value: Any) -> Optional[Dict[str, Any]]:
    """Validate and normalize an explicit numeric chord-mode entry."""
    if not isinstance(value, dict):
        return None

    raw_degree = value.get('degree')
    if (
        _is_integer(raw_degree)
    ):
        degree = int(raw_degree)
        alteration = value.get('alteration', 0)
        quality = value.get('quality')
        extension = value.get('extension', 'none')
        display = value.get('display')
        spelling = value.get('spelling', 'auto')
        if degree < 1 or degree > 7:
            return None
        if (
            not _is_integer(alteration)
            or alteration < -2
            or alteration > 2
        ):
            return None
        alteration = int(alteration)
        if not isinstance(quality, str) or not isinstance(extension, str):
            return None
        if quality not in QUALITY_SUFFIXES or extension not in EXTENSION_SUFFIXES:
            return None
        if display is not None and not isinstance(display, str):
            return None
        if spelling not in ('auto', 'flat', 'sharp'):
            return None
    else:
        return None

    chord_suffix = chord_mode_suffix(quality, extension)
    if chord_suffix is None:
        return None
    accidental = 'b' * -alteration if alteration < 0 else '#' * alteration
    return {
        'degree': degree,
        'alteration': alteration,
        'quality': quality,
        'extension': extension,
        'display': display if display is not None else f'{accidental}{degree}',
        'spelling': spelling,
        'chordSuffix': chord_suffix,
    }


def chord_mode_semitones(entry: Dict[str, Any]) -> int:
    return (MAJOR_SCALE_SEMITONES[entry['degree'] - 1] + entry['alteration']) % 12


def chord_mode_prefers_flat(entry: Dict[str, Any], root: str) -> bool:
    return entry['spelling'] == 'flat' or (
        entry['spelling'] == 'auto'
        and (entry['alteration'] < 0 or (entry['alteration'] == 0 and 'b' in root))
    )


def chord_mode_suffix(quality: str, extension: str) -> Optional[str]:
    if quality == 'major':
        return EXTENSION_SUFFIXES[extension]
    if quality == 'minor':
        if extension in ('maj7', 'maj9', 'add9'):
            return None
        return 'm' + EXTENSION_SUFFIXES[extension]
    if quality == 'diminished':
        return 'dim' if extension == 'none' else 'dim7' if extension == '7' else None
    if quality == 'augmented':
        return 'aug' if extension == 'none' else 'aug7' if extension == '7' else None
    if extension != 'none':
        return None
    return QUALITY_SUFFIXES[quality]
