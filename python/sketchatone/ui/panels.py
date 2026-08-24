"""
Panel registry for the native UI.

Mirrors ``src/components/sketchatone-dashboard/panel-visibility.ts``
so panel ids and labels stay aligned with the web build. Keep this
file in sync when panels are added or renamed on the web side.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Tuple


@dataclass(frozen=True)
class PanelInfo:
    id: str
    label: str


@dataclass(frozen=True)
class CategoryInfo:
    id: str
    label: str
    panel_ids: Tuple[str, ...]


PANELS: List[PanelInfo] = [
    PanelInfo('performance',       'Performance'),
    PanelInfo('midiDevices',       'MIDI Devices'),
    PanelInfo('tabletVisualizer',  'Tablet'),
    PanelInfo('midiInput',         'MIDI In'),
    PanelInfo('events',            'Events'),
    PanelInfo('noteVelocity',      'Velocity'),
    PanelInfo('noteDuration',      'Duration'),
    PanelInfo('pitchBend',         'Pitch'),
    PanelInfo('strummingSettings', 'Strumming'),
    PanelInfo('strumRelease',      'Release'),
    PanelInfo('slide',             'Slide'),
    PanelInfo('actions',           'Actions'),
    PanelInfo('groups',            'Groups'),
    PanelInfo('deviceButtons',     'Device Buttons'),
    PanelInfo('chordProgressions', 'Chord Progressions'),
]

# Two-level nav grouping for the kiosk tab bar. Panels not listed in any
# category fall through to the first category's first panel.
CATEGORIES: List[CategoryInfo] = [
    CategoryInfo('monitor', 'Monitor', (
        'performance', 'midiDevices', 'tabletVisualizer',
        'midiInput', 'events',
    )),
    CategoryInfo('sound', 'Sound', (
        'noteVelocity', 'noteDuration', 'pitchBend',
        'strummingSettings', 'strumRelease', 'slide',
    )),
    CategoryInfo('song', 'Song', (
        'actions', 'groups', 'deviceButtons', 'chordProgressions',
    )),
]

DEFAULT_PANEL_ID = PANELS[0].id
DEFAULT_CATEGORY_ID = CATEGORIES[0].id


def find_panel(panel_id: str) -> PanelInfo:
    """Return the PanelInfo for ``panel_id`` or raise ``KeyError``."""
    for panel in PANELS:
        if panel.id == panel_id:
            return panel
    raise KeyError(panel_id)


def find_category(category_id: str) -> CategoryInfo:
    """Return the CategoryInfo for ``category_id`` or raise ``KeyError``."""
    for cat in CATEGORIES:
        if cat.id == category_id:
            return cat
    raise KeyError(category_id)


def find_category_for_panel(panel_id: str) -> CategoryInfo:
    """Return the category that contains ``panel_id``, or the first one."""
    for cat in CATEGORIES:
        if panel_id in cat.panel_ids:
            return cat
    return CATEGORIES[0]
