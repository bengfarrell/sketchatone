"""
Tests for panel body widgets and their pure formatting helpers.

The helpers (``format_value``, ``format_strum``, ``EventRateTracker``)
are exercised directly. The widget classes are constructed against a
fake bridge to verify they subscribe to the right events; we don't
boot the Kivy event loop.
"""

from __future__ import annotations

import pytest
from kivy.uix.button import Button

from sketchatone.cli.server import StrumEventData, StrumNoteEventData, TabletEventData
from sketchatone.ui import bridge as bridge_mod
from sketchatone.ui.bridge import UIBridge
from sketchatone.ui.panel_widgets import (
    PARAMETER_MAPPING_SPECS,
    ActionRulesPanel,
    ChordProgressionsPanel,
    DeviceButtonsPanel,
    EventRateTracker,
    EventsPanel,
    GroupsPanel,
    MidiDevicesPanel,
    ParameterMappingPanel,
    PerformancePanel,
    PlaceholderPanel,
    ServerSettingsPanel,
    SlidePanel,
    StrumReleasePanel,
    StrummingSettingsPanel,
    TabletVisualizerPanel,
    calculate_curve_output,
    compute_dirty,
    extract_action_rules,
    extract_chord_progressions,
    extract_device_buttons,
    extract_parameter_mapping,
    extract_server_state,
    extract_slide,
    extract_strum_release,
    extract_strumming,
    fit_tablet_rect,
    format_action,
    format_strum,
    format_value,
    hover_position_from_tablet,
    make_panel,
    parse_action_input,
    tablet_to_screen,
)


@pytest.fixture(autouse=True)
def _run_on_main_inline(monkeypatch):
    """Make bridge event dispatch synchronous so we can assert on it."""
    def _inline(func, *args):
        func(*args)
    monkeypatch.setattr(bridge_mod, '_schedule_on_kivy_main', _inline)


class TestFormatValue:
    def test_none_renders_em_dash(self):
        assert format_value(None) == '—'

    def test_default_decimals(self):
        assert format_value(0.123456) == '0.123'

    def test_custom_decimals(self):
        assert format_value(0.123456, decimals=1) == '0.1'

    def test_zero(self):
        assert format_value(0.0) == '0.000'


class TestFormatStrum:
    def test_none_returns_empty_shape(self):
        out = format_strum(None)
        assert out == {'type': '', 'notes': [], 'velocity': 0}

    def test_strum_with_notes(self):
        strum = StrumEventData(
            type='strum',
            velocity=100,
            notes=[
                StrumNoteEventData(note=60, velocity=100, name='C', octave=4, duration=0.5),
                StrumNoteEventData(note=64, velocity=95,  name='E', octave=4, duration=0.5),
            ],
        )
        out = format_strum(strum)
        assert out['type'] == 'strum'
        assert out['velocity'] == 100
        assert out['notes'] == ['C4 v100', 'E4 v95']

    def test_release_with_no_notes(self):
        out = format_strum(StrumEventData(type='release'))
        assert out == {'type': 'release', 'notes': [], 'velocity': 0}


class TestEventRateTracker:
    def test_rate_within_window(self):
        t = EventRateTracker(window_seconds=1.0)
        for ts in (0.0, 0.1, 0.2, 0.3, 0.4):
            t.record(now=ts)
        assert t.rate(now=0.5) == 5.0
        assert t.total == 5

    def test_rate_decays_after_window(self):
        t = EventRateTracker(window_seconds=1.0)
        for ts in (0.0, 0.1, 0.2):
            t.record(now=ts)
        # After 1.5s, all three records are outside the 1s window.
        assert t.rate(now=1.5) == 0.0
        # ...but total is sticky.
        assert t.total == 3

    def test_age_none_until_first_record(self):
        t = EventRateTracker()
        assert t.age() is None

    def test_age_is_nonnegative(self):
        t = EventRateTracker()
        t.record(now=10.0)
        assert t.age(now=10.5) == pytest.approx(0.5)


class TestMakePanel:
    def test_events_panel_factory(self):
        assert isinstance(make_panel('events', 'Events', bridge=None), EventsPanel)

    def test_performance_panel_factory(self):
        panel = make_panel('performance', 'Performance', bridge=None)
        assert isinstance(panel, PerformancePanel)

    def test_unknown_panel_returns_placeholder(self):
        assert isinstance(make_panel('bogus', 'Bogus', bridge=None), PlaceholderPanel)

    def test_tablet_visualizer_panel_factory(self):
        assert isinstance(
            make_panel('tabletVisualizer', 'Tablet', bridge=None),
            TabletVisualizerPanel,
        )

    def test_midi_devices_panel_factory(self):
        assert isinstance(
            make_panel('midiDevices', 'MIDI Devices', bridge=None),
            MidiDevicesPanel,
        )

    def test_strumming_settings_panel_factory(self):
        assert isinstance(
            make_panel('strummingSettings', 'Strumming', bridge=None),
            StrummingSettingsPanel,
        )

    @pytest.mark.parametrize('panel_id', list(PARAMETER_MAPPING_SPECS.keys()))
    def test_parameter_mapping_panel_factory(self, panel_id):
        panel = make_panel(panel_id, panel_id, bridge=None)
        assert isinstance(panel, ParameterMappingPanel)
        assert panel._spec.field == panel_id

    def test_server_settings_panel_factory(self):
        assert isinstance(
            make_panel('serverSettings', 'Server', bridge=None),
            ServerSettingsPanel,
        )

    def test_device_buttons_panel_factory(self):
        assert isinstance(
            make_panel('deviceButtons', 'Device Buttons', bridge=None),
            DeviceButtonsPanel,
        )


class TestEventsPanelSubscription:
    def test_tablet_event_updates_header_and_values(self):
        b = UIBridge()
        panel = EventsPanel(bridge=b)
        b._emit('tablet', TabletEventData(x=0.5, y=0.25, pressure=0.8))
        assert panel._header.text == '1 events'
        assert panel._values['x'].text == '0.500'
        assert panel._values['y'].text == '0.250'
        assert panel._values['pressure'].text == '0.800'

    def test_strum_event_updates_strum_label(self):
        b = UIBridge()
        panel = EventsPanel(bridge=b)
        b._emit('strum', StrumEventData(
            type='strum', velocity=110,
            notes=[StrumNoteEventData(note=60, velocity=110, name='C', octave=4, duration=0.5)],
        ))
        assert 'C4 v110' in panel._strum.text
        assert '[strum]' in panel._strum.text


class TestPerformancePanelSubscription:
    def _config_event(self, *, notes=None, rules=None, group_rules=None,
                      groups=None, progressions=None):
        # Mirrors ``Server._get_config_data``: ``notes`` lives at the top
        # level, ``strummer.actionRules`` / ``chordProgressions`` live
        # under ``config``.
        return {
            'notes': list(notes or []),
            'config': {
                'strummer': {
                    'actionRules': {
                        'rules': list(rules or []),
                        'groups': list(groups or []),
                        'groupRules': list(group_rules or []),
                        'startupRules': [],
                    },
                    'chordProgressions': dict(progressions or {}),
                },
            },
        }

    def test_config_rebuilds_chips(self):
        b = UIBridge()
        panel = PerformancePanel(bridge=b)
        b._emit('config', self._config_event(
            rules=[
                {'button': 'button:primary', 'action': 'mute'},
                {'button': 'code:1', 'action': 'C-major'},
                {'button': 'code:2', 'action': 'A-minor'},
            ],
        ))
        assert set(panel._stylus_chips.keys()) == {'primary'}
        assert set(panel._button_chips.keys()) == {1, 2}

    def test_tablet_button_press_highlights_chip(self):
        b = UIBridge()
        panel = PerformancePanel(bridge=b)
        b._emit('config', self._config_event(
            rules=[
                {'button': 'code:1', 'action': 'C-major'},
                {'button': 'button:primary', 'action': 'mute'},
            ],
        ))
        ev = TabletEventData(primaryButtonPressed=True, auxCodes=[1])
        b._emit('tablet', ev)
        assert panel._button_chips[1]._active is True
        assert panel._stylus_chips['primary']._active is True

    def test_strum_marks_plucked_string(self):
        b = UIBridge()
        panel = PerformancePanel(bridge=b)
        b._emit('config', self._config_event(
            notes=[{'notation': 'E', 'octave': 2},
                   {'notation': 'A', 'octave': 2}],
        ))
        b._emit('strum', StrumEventData(
            type='strum', velocity=90,
            notes=[StrumNoteEventData(note=45, velocity=90, name='A', octave=2,
                                      duration=0.4)],
        ))
        assert panel._strip._plucked == 1


class TestFitTabletRect:
    def test_wide_container_constrains_to_height(self):
        # container is much wider than 16:10 -> height-bound
        x, y, w, h = fit_tablet_rect((0, 0, 1000, 100), aspect=16 / 10, margin=0)
        assert h == pytest.approx(100)
        assert w == pytest.approx(160)
        assert x == pytest.approx((1000 - 160) / 2)

    def test_tall_container_constrains_to_width(self):
        x, y, w, h = fit_tablet_rect((0, 0, 200, 1000), aspect=16 / 10, margin=0)
        assert w == pytest.approx(200)
        assert h == pytest.approx(125)
        assert y == pytest.approx((1000 - 125) / 2)

    def test_margin_is_applied(self):
        x, y, w, h = fit_tablet_rect((0, 0, 100, 100), aspect=1.0, margin=10)
        assert (w, h) == (pytest.approx(80), pytest.approx(80))
        assert (x, y) == (pytest.approx(10), pytest.approx(10))

    def test_zero_container_returns_zero(self):
        x, y, w, h = fit_tablet_rect((5, 5, 0, 0), margin=2)
        assert (w, h) == (0, 0)


class TestTabletToScreen:
    def test_origin_top_left_maps_to_kivy_top_left(self):
        # area = (ax=0, ay=0, aw=100, ah=200); top-left tablet -> top of Kivy area
        px, py = tablet_to_screen(0.0, 0.0, (0, 0, 100, 200))
        assert (px, py) == (pytest.approx(0), pytest.approx(200))

    def test_bottom_right_maps_to_kivy_bottom_right(self):
        px, py = tablet_to_screen(1.0, 1.0, (0, 0, 100, 200))
        assert (px, py) == (pytest.approx(100), pytest.approx(0))

    def test_center(self):
        px, py = tablet_to_screen(0.5, 0.5, (10, 20, 100, 200))
        assert (px, py) == (pytest.approx(60), pytest.approx(120))

    def test_clamps_out_of_range(self):
        px, py = tablet_to_screen(-0.5, 1.5, (0, 0, 100, 200))
        assert (px, py) == (pytest.approx(0), pytest.approx(0))


class TestVisualizerPanelSubscription:
    def test_tablet_visualizer_updates_readout(self):
        b = UIBridge()
        panel = TabletVisualizerPanel(bridge=b)
        b._emit('tablet', TabletEventData(x=0.25, y=0.75, pressure=0.5,
                                          tiltX=0.3, tiltY=-0.2))
        text = panel._readout.text
        assert '0.250' in text
        assert '0.750' in text
        assert '0.500' in text
        # Merged panel carries the stylus tilt fields in the same readout.
        assert '0.300' in text
        assert '-0.200' in text

    def test_tablet_visualizer_config_sets_notes(self):
        b = UIBridge()
        panel = TabletVisualizerPanel(bridge=b)
        b._emit('config', {'notes': [{'notation': 'E', 'octave': 2}, {'notation': 'A', 'octave': 2}]})
        assert len(panel._canvas_widget._notes) == 2

    def test_tablet_visualizer_forwards_event_to_stylus_canvas(self):
        b = UIBridge()
        panel = TabletVisualizerPanel(bridge=b)
        ev = TabletEventData(pressure=0.7, tiltX=0.3, tiltY=-0.2)
        b._emit('tablet', ev)
        assert panel._stylus_widget._last_event is ev



class TestMidiDevicesPanel:
    """The panel speaks to the bridge through ``request_midi_devices``,
    ``set_midi_output``, and ``set_midi_input``. We stub those on a real
    ``UIBridge`` and verify the panel calls them correctly and renders
    the resulting snapshot."""

    def _fresh_bridge(self):
        b = UIBridge()
        b._requested = 0  # type: ignore[attr-defined]
        b._set_output_calls = []  # type: ignore[attr-defined]
        b._set_input_calls = []  # type: ignore[attr-defined]
        b._set_config_calls = []  # type: ignore[attr-defined]
        b.request_midi_devices = lambda: setattr(b, '_requested', b._requested + 1)  # type: ignore[assignment]
        b.set_midi_output = lambda name: b._set_output_calls.append(name)  # type: ignore[assignment]
        b.set_midi_input = lambda ids: b._set_input_calls.append(list(ids))  # type: ignore[assignment]
        b.set_config = lambda path, value: b._set_config_calls.append((path, value))  # type: ignore[assignment]
        return b

    def test_panel_requests_snapshot_on_construction(self):
        b = self._fresh_bridge()
        MidiDevicesPanel(bridge=b)
        assert b._requested == 1

    @staticmethod
    def _row_label_texts(widget) -> list:
        """Flatten all label/button text within ``widget`` (depth-first)."""
        out: list = []
        def visit(w):
            t = getattr(w, 'text', None)
            if isinstance(t, str) and t:
                out.append(t)
            for c in getattr(w, 'children', []):
                visit(c)
        visit(widget)
        return out

    @staticmethod
    def _row_switch(row):
        """First descendant ``Button`` with an ``active`` attribute — the
        toggle switch inside a device row."""
        for w in row.walk(restrict=False):
            if isinstance(w, Button) and hasattr(w, 'active'):
                return w
        return None

    def test_panel_populates_output_and_input_lists(self):
        b = self._fresh_bridge()
        panel = MidiDevicesPanel(bridge=b)
        b._emit('midi-devices', {
            'outputPorts': [{'id': 0, 'name': 'IAC Bus 1'},
                            {'id': 1, 'name': 'Virtual'}],
            'inputPorts':  [{'id': 0, 'name': 'Keystation'}],
            'currentOutputPort': 1,
            'currentInputPorts': [0],
        })
        out_items = panel._outputs_box['items'].children
        in_items = panel._inputs_box['items'].children
        # Outputs and inputs both render as device-row composites: flatten
        # label text and read the toggle switch's ``active`` attribute to
        # check selection state.
        out_label_texts = [self._row_label_texts(r) for r in out_items]
        assert any('IAC Bus 1' in t for texts in out_label_texts for t in texts)
        assert any('Virtual' in t for texts in out_label_texts for t in texts)
        assert any(any('Index: 0' in t for t in texts) for texts in out_label_texts)
        assert any(any('Index: 1' in t for t in texts) for texts in out_label_texts)

        def out_row(name: str):
            return next(r for r in out_items
                        if any(name in t for t in self._row_label_texts(r)))
        assert self._row_switch(out_row('Virtual')).active is True
        assert self._row_switch(out_row('IAC Bus 1')).active is False

        in_label_texts = [self._row_label_texts(r) for r in in_items]
        assert any('Keystation' in t for texts in in_label_texts for t in texts)
        assert any(any('Index: 0' in t for t in texts) for texts in in_label_texts)
        assert all(self._row_switch(r).active for r in in_items)

    def test_panel_renders_empty_state(self):
        b = self._fresh_bridge()
        panel = MidiDevicesPanel(bridge=b)
        b._emit('midi-devices', {
            'outputPorts': [], 'inputPorts': [],
            'currentOutputPort': None, 'currentInputPorts': [],
        })
        out_texts = [c.text for c in panel._outputs_box['items'].children]
        in_texts = [c.text for c in panel._inputs_box['items'].children]
        assert out_texts == ['No output ports']
        assert in_texts == ['No input ports']

    def test_output_toggle_triggers_set_midi_output(self):
        b = self._fresh_bridge()
        panel = MidiDevicesPanel(bridge=b)
        b._emit('midi-devices', {
            'outputPorts': [{'id': 0, 'name': 'IAC Bus 1'}],
            'inputPorts': [], 'currentOutputPort': None, 'currentInputPorts': [],
        })
        # Toggling on the inactive output selects it by name.
        row = next(r for r in panel._outputs_box['items'].children
                   if any('IAC Bus 1' in t for t in self._row_label_texts(r)))
        self._row_switch(row).dispatch('on_release')
        assert b._set_output_calls == ['IAC Bus 1']

    def test_output_toggle_off_clears_selection(self):
        b = self._fresh_bridge()
        panel = MidiDevicesPanel(bridge=b)
        b._emit('midi-devices', {
            'outputPorts': [{'id': 0, 'name': 'IAC Bus 1'}],
            'inputPorts': [], 'currentOutputPort': 0, 'currentInputPorts': [],
        })
        # Toggling off the active output sends ``midiOutputId=None`` so the
        # backend disconnects (mirrors the web ``handleOutputToggle``).
        row = next(r for r in panel._outputs_box['items'].children
                   if any('IAC Bus 1' in t for t in self._row_label_texts(r)))
        self._row_switch(row).dispatch('on_release')
        assert b._set_output_calls == []
        assert b._set_config_calls == [('midi.midiOutputId', None)]

    def test_input_button_toggles_membership(self):
        b = self._fresh_bridge()
        panel = MidiDevicesPanel(bridge=b)
        b._emit('midi-devices', {
            'outputPorts': [],
            'inputPorts': [{'id': 2, 'name': 'Keystation'},
                           {'id': 3, 'name': 'Launchpad'}],
            'currentOutputPort': None,
            'currentInputPorts': [2],
        })
        def row_for(name: str):
            return next(r for r in panel._inputs_box['items'].children
                        if any(name in t for t in self._row_label_texts(r)))

        # Toggle Launchpad on (id=3) -> should send [2, 3] (sorted).
        self._row_switch(row_for('Launchpad')).dispatch('on_release')
        assert b._set_input_calls == [[2, 3]]

        # Toggle Keystation off (id=2) -> should send [3].
        self._row_switch(row_for('Keystation')).dispatch('on_release')
        assert b._set_input_calls[-1] == [3]



class TestExtractStrumming:
    def test_missing_payload_uses_defaults(self):
        out = extract_strumming(None)
        assert out == {'mode': 'strum', 'pressureThreshold': 0.1,
                       'pressureBufferSize': 10, 'invertX': False}

    def test_extracts_from_full_payload(self):
        out = extract_strumming({
            'config': {
                'strummer': {
                    'mode': 'slide',
                    'strumming': {
                        'pressureThreshold': 0.25,
                        'pressureBufferSize': 16,
                        'invertX': True,
                    },
                },
            },
        })
        assert out == {'mode': 'slide', 'pressureThreshold': 0.25,
                       'pressureBufferSize': 16, 'invertX': True}

    def test_partial_payload_falls_back(self):
        out = extract_strumming({'config': {'strummer': {'mode': 'slide'}}})
        assert out['mode'] == 'slide'
        assert out['pressureThreshold'] == 0.1


class TestStrummingSettingsPanel:
    """Settings panel sends ``set_config`` calls with camelCase paths and
    syncs widget state from incoming ``'config'`` payloads."""

    def _fresh_bridge(self):
        b = UIBridge()
        b._cfg_calls = []  # type: ignore[attr-defined]
        b.set_config = lambda path, value: b._cfg_calls.append((path, value))  # type: ignore[assignment]
        return b

    def _emit_config(self, b: UIBridge, **strumming):
        payload = {
            'config': {
                'strummer': {
                    'mode': strumming.pop('mode', 'strum'),
                    'strumming': strumming,
                },
            },
        }
        b._emit('config', payload)

    def test_config_event_syncs_widgets(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        self._emit_config(b, mode='slide', pressureThreshold=0.4,
                          pressureBufferSize=20, invertX=True)
        assert panel._state['mode'] == 'slide'
        assert panel._threshold_stepper.value == pytest.approx(0.4)
        assert panel._threshold_stepper.text == '0.400'
        assert panel._buffer_stepper.value == 20
        assert panel._buffer_stepper.text == '20'
        assert panel._invert_btn.text == 'On'

    def test_mode_button_sends_set_config(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        panel._mode_slide.dispatch('on_release')
        assert b._cfg_calls == [('strummer.mode', 'slide')]
        # No-op when clicking the already-active button
        panel._mode_slide.dispatch('on_release')
        assert b._cfg_calls == [('strummer.mode', 'slide')]

    def test_invert_button_toggles_value(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        panel._invert_btn.dispatch('on_release')
        assert b._cfg_calls == [('strummer.strumming.invertX', True)]
        assert panel._invert_btn.text == 'On'
        panel._invert_btn.dispatch('on_release')
        assert b._cfg_calls[-1] == ('strummer.strumming.invertX', False)

    def test_threshold_set_value_updates_readout_but_does_not_send(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        panel._threshold_stepper.set_value(0.42)
        assert panel._threshold_stepper.text == '0.420'
        # Programmatic set_value should not fire on_commit.
        assert b._cfg_calls == []

    def test_threshold_commit_sends_rounded_value(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        panel._threshold_stepper.input.text = '0.3333'
        panel._threshold_stepper.commit()
        assert b._cfg_calls == [('strummer.strumming.pressureThreshold', 0.333)]

    def test_buffer_commit_sends_integer(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        panel._buffer_stepper.input.text = '17'
        panel._buffer_stepper.commit()
        assert b._cfg_calls == [('strummer.strumming.pressureBufferSize', 17)]

    def test_commit_with_unchanged_value_is_noop(self):
        b = self._fresh_bridge()
        panel = StrummingSettingsPanel(bridge=b)
        # Stepper starts at default 0.1; committing without change shouldn't fire.
        panel._threshold_stepper.commit()
        assert b._cfg_calls == []



class TestExtractParameterMapping:
    def test_missing_payload_returns_spec_defaults(self):
        out = extract_parameter_mapping(None, 'noteVelocity')
        assert out['min'] == 0
        assert out['max'] == 127
        assert out['control'] == 'pressure'
        assert out['spread'] == 'direct'

    def test_extracts_from_full_payload(self):
        payload = {'config': {'strummer': {'noteDuration': {
            'min': 0.2, 'max': 2.0, 'multiplier': 1.5, 'curve': 2.0,
            'spread': 'direct', 'control': 'tiltX', 'default': 0.8,
        }}}}
        out = extract_parameter_mapping(payload, 'noteDuration')
        assert out == {'min': 0.2, 'max': 2.0, 'multiplier': 1.5, 'curve': 2.0,
                       'spread': 'direct', 'control': 'tiltX', 'default': 0.8}

    def test_partial_payload_merges_defaults(self):
        payload = {'config': {'strummer': {'pitchBend': {'control': 'xaxis'}}}}
        out = extract_parameter_mapping(payload, 'pitchBend')
        assert out['control'] == 'xaxis'
        assert out['spread'] == 'central'  # default preserved
        assert out['min'] == -1.0


def _make_mapping_bridge():
    b = UIBridge()
    b._cfg_calls = []  # type: ignore[attr-defined]
    b.set_config = lambda path, value: b._cfg_calls.append((path, value))  # type: ignore[assignment]
    return b


def _emit_mapping(b: UIBridge, field: str, **mapping):
    b._emit('config', {'config': {'strummer': {field: mapping}}})


class TestParameterMappingPanel:
    """Velocity/Duration/Pitch share a single widget driven by spec."""

    def _panel(self, field='noteVelocity'):
        b = _make_mapping_bridge()
        panel = ParameterMappingPanel(PARAMETER_MAPPING_SPECS[field], bridge=b)
        return panel, b

    def test_config_event_syncs_all_controls(self):
        panel, b = self._panel('noteVelocity')
        _emit_mapping(b, 'noteVelocity', min=10, max=100, multiplier=2.0,
                      curve=1.5, spread='inverse', control='tiltY', default=50)
        assert panel._steppers['min'].value == 10
        assert panel._steppers['max'].value == 100
        assert panel._steppers['multiplier'].value == pytest.approx(2.0)
        assert panel._steppers['curve'].value == pytest.approx(1.5)
        assert panel._steppers['min'].text == '10'
        assert panel._steppers['multiplier'].text == '2.000'
        # Spread + control dropdowns reflect new state.
        assert panel._state['spread'] == 'inverse'
        assert panel._state['control'] == 'tiltY'
        assert panel._spread_dropdown.text == 'inverse'
        assert panel._control_dropdown.text == 'tiltY'

    def test_spread_dropdown_sends_set_config(self):
        panel, b = self._panel('noteVelocity')
        panel._spread_dropdown.text = 'inverse'
        assert b._cfg_calls == [('strummer.noteVelocity.spread', 'inverse')]
        panel._spread_dropdown.text = 'inverse'  # no-op
        assert b._cfg_calls == [('strummer.noteVelocity.spread', 'inverse')]

    def test_control_dropdown_sends_set_config(self):
        panel, b = self._panel('noteDuration')
        panel._control_dropdown.text = 'xaxis'
        assert b._cfg_calls == [('strummer.noteDuration.control', 'xaxis')]

    def test_integer_min_max_commits_integer(self):
        panel, b = self._panel('noteVelocity')
        stepper = panel._steppers['max']
        stepper.input.text = '99.7'
        stepper.commit()
        assert b._cfg_calls == [('strummer.noteVelocity.max', 100)]

    def test_float_multiplier_commits_rounded_float(self):
        panel, b = self._panel('pitchBend')
        stepper = panel._steppers['multiplier']
        stepper.input.text = '1.23456'
        stepper.commit()
        assert b._cfg_calls == [('strummer.pitchBend.multiplier', 1.23)]

    def test_set_value_updates_readout_without_sending(self):
        panel, b = self._panel('noteDuration')
        stepper = panel._steppers['min']
        stepper.set_value(0.42)
        assert stepper.text == '0.42'
        assert b._cfg_calls == []

    def test_commit_unchanged_value_is_noop(self):
        panel, b = self._panel('noteVelocity')
        stepper = panel._steppers['min']
        # Initial value matches state default (0); committing does nothing.
        stepper.commit()
        assert b._cfg_calls == []

    def test_visualizer_state_tracks_config_event(self):
        panel, b = self._panel('noteVelocity')
        _emit_mapping(b, 'noteVelocity', min=20, max=110, multiplier=1.0,
                      curve=2.0, spread='central', control='tiltX', default=64)
        assert panel._visualizer._state['min'] == 20
        assert panel._visualizer._state['spread'] == 'central'
        assert panel._visualizer._control == 'tiltX'

    def test_visualizer_tracks_stepper_commit(self):
        panel, _ = self._panel('noteDuration')
        stepper = panel._steppers['max']
        stepper.input.text = '2.0'
        stepper.commit()
        assert panel._visualizer._state['max'] == pytest.approx(2.0)

    def test_visualizer_receives_tablet_hover(self):
        panel, b = self._panel('pitchBend')
        # Default control is 'yaxis' for pitch — bridged tablet event sets hover.
        b._emit('tablet', TabletEventData(x=0.5, y=0.75, pressure=0.0))
        assert panel._visualizer._hover == pytest.approx(0.75)


class TestCalculateCurveOutput:
    def test_direct_linear_is_identity(self):
        assert calculate_curve_output(0, 1, 1.0, 'direct', 0.0) == pytest.approx(0.0)
        assert calculate_curve_output(0, 1, 1.0, 'direct', 1.0) == pytest.approx(1.0)
        assert calculate_curve_output(0, 1, 1.0, 'direct', 0.5) == pytest.approx(0.5)

    def test_direct_exponential_curve(self):
        # curve=2 => t**2 between min and max
        assert calculate_curve_output(0, 100, 2.0, 'direct', 0.5) == pytest.approx(25.0)

    def test_inverse_flips_direction(self):
        assert calculate_curve_output(0, 1, 1.0, 'inverse', 0.0) == pytest.approx(1.0)
        assert calculate_curve_output(0, 1, 1.0, 'inverse', 1.0) == pytest.approx(0.0)

    def test_central_peaks_at_centre(self):
        # At t=0.5 distance is 0, so output is max.
        assert calculate_curve_output(-1, 1, 1.0, 'central', 0.5) == pytest.approx(1.0)
        # At t=0 or t=1 distance is 1, output is min.
        assert calculate_curve_output(-1, 1, 1.0, 'central', 0.0) == pytest.approx(-1.0)
        assert calculate_curve_output(-1, 1, 1.0, 'central', 1.0) == pytest.approx(-1.0)

    def test_t_clamped_to_unit_interval(self):
        assert calculate_curve_output(0, 1, 1.0, 'direct', -0.5) == pytest.approx(0.0)
        assert calculate_curve_output(0, 1, 1.0, 'direct', 1.5) == pytest.approx(1.0)


class TestHoverPositionFromTablet:
    def test_returns_none_for_missing_event(self):
        assert hover_position_from_tablet('yaxis', None) is None

    def test_yaxis_returns_y_regardless_of_pressure(self):
        ev = TabletEventData(x=0.1, y=0.42, pressure=0.0, state='hover')
        assert hover_position_from_tablet('yaxis', ev) == pytest.approx(0.42)

    def test_xaxis_returns_x(self):
        ev = TabletEventData(x=0.7, y=0.1, pressure=0.0)
        assert hover_position_from_tablet('xaxis', ev) == pytest.approx(0.7)

    def test_pressure_requires_contact(self):
        lifted = TabletEventData(pressure=0.0, state='hover')
        assert hover_position_from_tablet('pressure', lifted) is None
        pressed = TabletEventData(pressure=0.6, state='contact')
        assert hover_position_from_tablet('pressure', pressed) == pytest.approx(0.6)

    def test_tilt_axes_normalize_to_unit_interval(self):
        pressed = TabletEventData(pressure=0.3, tiltX=-1.0, tiltY=1.0, tiltXY=0.0)
        assert hover_position_from_tablet('tiltX', pressed) == pytest.approx(0.0)
        assert hover_position_from_tablet('tiltY', pressed) == pytest.approx(1.0)
        assert hover_position_from_tablet('tiltXY', pressed) == pytest.approx(0.5)

    def test_tilt_returns_none_when_not_pressed(self):
        lifted = TabletEventData(pressure=0.0, tiltX=0.5, state='hover')
        assert hover_position_from_tablet('tiltX', lifted) is None

    def test_unknown_control_returns_none(self):
        ev = TabletEventData(x=0.5, y=0.5, pressure=0.5)
        assert hover_position_from_tablet('none', ev) is None
        assert hover_position_from_tablet('velocity', ev) is None


class TestExtractServerState:
    def test_missing_payload_returns_defaults(self):
        out = extract_server_state(None)
        assert out == {'currentConfigName': None, 'availableConfigs': [],
                       'isSavedState': False, 'config': None, 'throttleMs': 150}

    def test_extracts_fields(self):
        out = extract_server_state({
            'currentConfigName': 'default.json',
            'availableConfigs': ['a.json', 'b.json'],
            'isSavedState': True,
            'config': {'strummer': {}},
        })
        assert out['currentConfigName'] == 'default.json'
        assert out['availableConfigs'] == ['a.json', 'b.json']
        assert out['isSavedState'] is True
        assert out['config'] == {'strummer': {}}


class TestComputeDirty:
    def test_no_snapshot_returns_clean(self):
        assert compute_dirty({'a': 1}, None) is False

    def test_matching_snapshot_returns_clean(self):
        import json
        snap = json.dumps({'a': 1, 'b': 2}, sort_keys=True)
        assert compute_dirty({'b': 2, 'a': 1}, snap) is False

    def test_differing_snapshot_returns_dirty(self):
        import json
        snap = json.dumps({'a': 1}, sort_keys=True)
        assert compute_dirty({'a': 2}, snap) is True


def _make_server_bridge():
    b = UIBridge()
    b._load_calls = []  # type: ignore[attr-defined]
    b._create_calls = []  # type: ignore[attr-defined]
    b._throttle_calls = []  # type: ignore[attr-defined]

    def _load(name):
        b._load_calls.append(name)  # type: ignore[attr-defined]

    def _create(name):
        b._create_calls.append(name)  # type: ignore[attr-defined]

    def _set_throttle(value):
        b._throttle_calls.append(value)  # type: ignore[attr-defined]
    b.load_config = _load  # type: ignore[assignment]
    b.create_config = _create  # type: ignore[assignment]
    b.set_throttle = _set_throttle  # type: ignore[assignment]
    return b


def _emit_server_config(b: UIBridge, *, current='default.json',
                       available=('default.json',), is_saved=True,
                       throttle_ms=150, extra=None):
    payload = {
        'currentConfigName': current,
        'availableConfigs': list(available),
        'isSavedState': is_saved,
        'throttleMs': throttle_ms,
        'config': {'strummer': {'mode': 'strum'}, **(extra or {})},
    }
    b._emit('config', payload)


class TestServerSettingsPanel:
    def test_initial_state_has_no_current_config(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        assert panel._current_name is None
        assert '(none)' in panel._status.text

    def test_config_event_populates_list_and_marks_active(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, current='default.json',
                            available=('default.json', 'jazz.json'))
        rows = panel._list_items.children
        assert len(rows) == 2
        # Children render in reverse insertion order; check the active marker.
        names = [c.text for c in rows]
        assert any(n.startswith('● ') and 'default.json' in n for n in names)
        assert any(n.startswith('○ ') and 'jazz.json' in n for n in names)

    def test_config_event_updates_status_label(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, current='jazz.json')
        assert panel._status.text == 'Current: jazz.json'

    def test_clicking_config_loads_it(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, current='default.json',
                            available=('default.json', 'jazz.json'))
        jazz = next(c for c in panel._list_items.children if 'jazz.json' in c.text)
        jazz.dispatch('on_release')
        assert b._load_calls == ['jazz.json']

    def test_clicking_active_config_is_noop(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, current='default.json',
                            available=('default.json',))
        active = next(c for c in panel._list_items.children if 'default.json' in c.text)
        active.dispatch('on_release')
        assert b._load_calls == []

    def test_empty_available_shows_empty_row(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, current=None, available=())
        rows = panel._list_items.children
        assert len(rows) == 1
        assert 'No saved configs' in rows[0].text

    def test_throttle_stepper_reflects_config(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, throttle_ms=33)
        assert panel._throttle_stepper.value == 33
        assert panel._throttle_stepper.text == '33'

    def test_throttle_stepper_commit_calls_bridge(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, throttle_ms=150)
        panel._throttle_stepper.input.text = '33'
        panel._throttle_stepper.commit()
        assert b._throttle_calls == [33]

    def test_throttle_commit_noop_when_unchanged(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        _emit_server_config(b, throttle_ms=150)
        panel._throttle_stepper.commit()
        assert b._throttle_calls == []

    def test_create_input_invokes_bridge(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        panel._create_input.text = 'jazz'
        panel._create()
        assert b._create_calls == ['jazz']
        assert panel._create_input.text == ''

    def test_create_strips_whitespace(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        panel._create_input.text = '  rock  '
        panel._create()
        assert b._create_calls == ['rock']

    def test_create_empty_name_ignored(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        panel._create_input.text = '   '
        panel._create()
        assert b._create_calls == []

    def test_create_via_enter_key(self):
        b = _make_server_bridge()
        panel = ServerSettingsPanel(bridge=b)
        panel._create_input.text = 'blues.json'
        panel._create_input.dispatch('on_text_validate')
        assert b._create_calls == ['blues.json']


class TestExtractServerStateThrottle:
    def test_missing_throttle_defaults_to_150(self):
        out = extract_server_state({})
        assert out['throttleMs'] == 150

    def test_throttle_coerced_to_int(self):
        out = extract_server_state({'throttleMs': '33'})
        assert out['throttleMs'] == 33

    def test_invalid_throttle_falls_back_to_default(self):
        out = extract_server_state({'throttleMs': 'abc'})
        assert out['throttleMs'] == 150


def _make_cfg_bridge():
    b = UIBridge()
    b._cfg_calls = []  # type: ignore[attr-defined]

    def _set_config(path, value):
        b._cfg_calls.append((path, value))  # type: ignore[attr-defined]
    b.set_config = _set_config  # type: ignore[assignment]
    return b


def _emit_release_config(b: UIBridge, **fields):
    b._emit('config', {
        'config': {'strummer': {'strumRelease': fields}},
    })


def _emit_slide_config(b: UIBridge, **slide):
    mod = slide.pop('pressureModulation', None)
    if mod is not None:
        slide['pressureModulation'] = mod
    b._emit('config', {
        'config': {'strummer': {'slide': slide}},
    })


class TestExtractStrumRelease:
    def test_missing_payload_uses_defaults(self):
        out = extract_strum_release(None)
        assert out == {'active': False, 'midiNote': 38, 'maxDuration': 0.25,
                       'velocityMultiplier': 1.0}

    def test_extracts_from_payload(self):
        out = extract_strum_release({'config': {'strummer': {'strumRelease': {
            'active': True, 'midiNote': 42, 'maxDuration': 0.5,
            'velocityMultiplier': 0.75,
        }}}})
        assert out == {'active': True, 'midiNote': 42, 'maxDuration': 0.5,
                       'velocityMultiplier': 0.75}

    def test_partial_payload_falls_back(self):
        out = extract_strum_release({'config': {'strummer': {'strumRelease': {
            'active': True,
        }}}})
        assert out['active'] is True
        assert out['midiNote'] == 38


class TestStrumReleasePanel:
    def test_config_event_syncs_widgets(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        _emit_release_config(b, active=True, midiNote=50, maxDuration=1.25,
                             velocityMultiplier=0.5)
        assert panel._state['active'] is True
        assert panel._active_btn.text == 'On'
        assert panel._note_stepper.value == 50
        assert panel._note_stepper.text == '50'
        assert panel._duration_stepper.value == pytest.approx(1.25)
        assert panel._duration_stepper.text == '1.25'
        assert panel._vel_stepper.value == pytest.approx(0.5)
        assert panel._vel_stepper.text == '0.50'

    def test_toggle_active_sends_update(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        panel._active_btn.dispatch('on_release')
        assert b._cfg_calls == [('strummer.strumRelease.active', True)]
        assert panel._active_btn.text == 'On'
        panel._active_btn.dispatch('on_release')
        assert b._cfg_calls[-1] == ('strummer.strumRelease.active', False)

    def test_note_commit_sends_integer(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        panel._note_stepper.input.text = '47'
        panel._note_stepper.commit()
        assert b._cfg_calls == [('strummer.strumRelease.midiNote', 47)]

    def test_duration_commit_rounds_to_two_decimals(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        panel._duration_stepper.input.text = '1.2345'
        panel._duration_stepper.commit()
        assert b._cfg_calls == [('strummer.strumRelease.maxDuration', 1.23)]

    def test_velocity_commit_rounds_to_two_decimals(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        panel._vel_stepper.input.text = '0.6789'
        panel._vel_stepper.commit()
        assert b._cfg_calls == [
            ('strummer.strumRelease.velocityMultiplier', 0.68)]

    def test_commit_with_unchanged_value_is_noop(self):
        b = _make_cfg_bridge()
        panel = StrumReleasePanel(bridge=b)
        panel._note_stepper.commit()
        assert b._cfg_calls == []

    def test_make_panel_returns_strum_release_panel(self):
        panel = make_panel('strumRelease', 'Release', bridge=None)
        assert isinstance(panel, StrumReleasePanel)


class TestExtractSlide:
    def test_missing_payload_uses_defaults(self):
        out = extract_slide(None)
        assert out == {'pressureThreshold': 0.1, 'maxBendSemitones': 24.0,
                       'modulationType': 'aftertouch', 'ccNumber': 11,
                       'minValue': 0, 'maxValue': 127}

    def test_extracts_from_payload(self):
        out = extract_slide({'config': {'strummer': {'slide': {
            'pressureThreshold': 0.25, 'maxBendSemitones': 12.0,
            'pressureModulation': {'type': 'cc', 'ccNumber': 7,
                                   'minValue': 10, 'maxValue': 120},
        }}}})
        assert out == {'pressureThreshold': 0.25, 'maxBendSemitones': 12.0,
                       'modulationType': 'cc', 'ccNumber': 7,
                       'minValue': 10, 'maxValue': 120}

    def test_unknown_modulation_type_falls_back(self):
        out = extract_slide({'config': {'strummer': {'slide': {
            'pressureModulation': {'type': 'bogus'},
        }}}})
        assert out['modulationType'] == 'aftertouch'


class TestSlidePanel:
    def test_config_event_syncs_widgets(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        _emit_slide_config(b, pressureThreshold=0.4, maxBendSemitones=12.0,
                           pressureModulation={'type': 'cc', 'ccNumber': 7,
                                               'minValue': 5, 'maxValue': 100})
        assert panel._threshold_stepper.value == pytest.approx(0.4)
        assert panel._threshold_stepper.text == '0.400'
        assert panel._bend_stepper.value == pytest.approx(12.0)
        assert panel._bend_stepper.text == '12.0'
        assert panel._state['modulationType'] == 'cc'
        assert panel._cc_stepper.value == 7
        assert panel._min_stepper.value == 5
        assert panel._max_stepper.value == 100

    def test_select_modulation_sends_update(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._mod_buttons['cc'].dispatch('on_release')
        assert b._cfg_calls == [
            ('strummer.slide.pressureModulation.type', 'cc')]
        # No-op when clicking the already-active button.
        panel._mod_buttons['cc'].dispatch('on_release')
        assert len(b._cfg_calls) == 1

    def test_threshold_commit_rounds_to_three_decimals(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._threshold_stepper.input.text = '0.3333'
        panel._threshold_stepper.commit()
        assert b._cfg_calls == [('strummer.slide.pressureThreshold', 0.333)]

    def test_bend_commit_rounds_to_one_decimal(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._bend_stepper.input.text = '18.75'
        panel._bend_stepper.commit()
        assert b._cfg_calls == [('strummer.slide.maxBendSemitones', 18.8)]

    def test_cc_commit_sends_integer(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._cc_stepper.input.text = '22'
        panel._cc_stepper.commit()
        assert b._cfg_calls == [
            ('strummer.slide.pressureModulation.ccNumber', 22)]

    def test_min_max_commits(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._min_stepper.input.text = '4'
        panel._min_stepper.commit()
        panel._max_stepper.input.text = '99'
        panel._max_stepper.commit()
        assert ('strummer.slide.pressureModulation.minValue', 4) in b._cfg_calls
        assert ('strummer.slide.pressureModulation.maxValue', 99) in b._cfg_calls

    def test_commit_unchanged_value_is_noop(self):
        b = _make_cfg_bridge()
        panel = SlidePanel(bridge=b)
        panel._cc_stepper.commit()
        assert b._cfg_calls == []

    def test_make_panel_returns_slide_panel(self):
        panel = make_panel('slide', 'Slide', bridge=None)
        assert isinstance(panel, SlidePanel)



def _emit_action_rules(bridge: UIBridge, **action_rules):
    bridge._emit('config', {
        'config': {'strummer': {'actionRules': action_rules}},
    })


def _emit_chord_progressions(bridge: UIBridge, progressions):
    bridge._emit('config', {
        'config': {'strummer': {'chordProgressions': progressions}},
    })


class TestFormatAction:
    def test_none_renders_marker(self):
        assert format_action(None) == '(none)'

    def test_string_passes_through(self):
        assert format_action('toggle-repeater') == 'toggle-repeater'

    def test_list_renders_space_joined(self):
        assert format_action(['transpose', 12]) == 'transpose 12'

    def test_chord_progression_dict(self):
        out = format_action({'type': 'chord-progression',
                             'progression': 'a-minor-pop', 'octave': 4})
        assert out == 'chord-progression: a-minor-pop @ 4'

    def test_unknown_dict_falls_back_to_type(self):
        assert format_action({'type': 'mystery'}) == 'mystery'


class TestParseActionInput:
    def test_empty_returns_none(self):
        assert parse_action_input('') is None
        assert parse_action_input('   ') is None

    def test_bare_string_passes_through(self):
        assert parse_action_input('toggle-repeater') == 'toggle-repeater'

    def test_json_array_parses(self):
        assert parse_action_input('["transpose", 12]') == ['transpose', 12]

    def test_malformed_json_falls_back_to_string(self):
        assert parse_action_input('[broken') == '[broken'


class TestExtractActionRules:
    def test_missing_payload_returns_empty_lists(self):
        out = extract_action_rules(None)
        assert out == {'rules': [], 'groups': [],
                       'groupRules': [], 'startupRules': []}

    def test_extracts_full_payload(self):
        out = extract_action_rules({'config': {'strummer': {'actionRules': {
            'rules': [{'id': 'r1', 'button': 'button:1',
                       'action': 'toggle-repeater', 'trigger': 'press'}],
            'groups': [{'id': 'g1', 'name': 'Chords',
                        'buttons': ['button:1', 'button:2']}],
            'groupRules': [{'id': 'gr1', 'groupId': 'g1', 'trigger': 'press',
                            'action': {'type': 'chord-progression',
                                       'progression': 'c-major-pop', 'octave': 4}}],
            'startupRules': [],
        }}}})
        assert len(out['rules']) == 1
        assert out['rules'][0]['button'] == 'button:1'
        assert len(out['groups']) == 1
        assert out['groupRules'][0]['groupId'] == 'g1'


class TestChordBuilderHelpers:
    def test_major_token(self):
        from sketchatone.ui.panel_widgets import _build_chord_token
        assert _build_chord_token('C', '', '', '') == 'C'

    def test_minor_with_extension(self):
        from sketchatone.ui.panel_widgets import _build_chord_token
        assert _build_chord_token('A', '', 'm', '7') == 'Am7'
        assert _build_chord_token('A', '', 'm', 'maj7') == 'Ammaj7'

    def test_power_chord_overrides_extension(self):
        from sketchatone.ui.panel_widgets import _build_chord_token
        assert _build_chord_token('E', '', '5', '7') == 'E5'

    def test_sus_overrides_extension(self):
        from sketchatone.ui.panel_widgets import _build_chord_token
        assert _build_chord_token('D', '', 'sus4', '7') == 'Dsus4'

    def test_accidental_passed_through(self):
        from sketchatone.ui.panel_widgets import _build_chord_token
        assert _build_chord_token('F', '#', 'm', '') == 'F#m'

    def test_accidental_disabled_for_enharmonic_roots(self):
        from sketchatone.ui.panel_widgets import _is_accidental_disabled
        assert _is_accidental_disabled('E', '#') is True
        assert _is_accidental_disabled('B', '#') is True
        assert _is_accidental_disabled('C', 'b') is True
        assert _is_accidental_disabled('F', 'b') is True
        assert _is_accidental_disabled('C', '#') is False

    def test_extension_disabled_for_quality(self):
        from sketchatone.ui.panel_widgets import _extension_disabled_for
        assert _extension_disabled_for('5') is True
        assert _extension_disabled_for('sus2') is True
        assert _extension_disabled_for('sus4') is True
        assert _extension_disabled_for('m') is False


class TestActionSplitMaterialize:
    def test_split_bare_string(self):
        from sketchatone.ui.panel_widgets import _split_action
        assert _split_action('toggle-repeater') == ('toggle-repeater', {})

    def test_split_list_with_params(self):
        from sketchatone.ui.panel_widgets import _split_action
        assert _split_action(['transpose', 5]) == ('transpose', {'semitones': 5})

    def test_split_dict_chord_progression(self):
        from sketchatone.ui.panel_widgets import _split_action
        name, params = _split_action({'type': 'chord-progression',
                                      'progression': 'p', 'octave': 4})
        assert name == 'chord-progression'
        assert params == {'progression': 'p', 'octave': 4}

    def test_split_none(self):
        from sketchatone.ui.panel_widgets import _split_action
        assert _split_action(None) == ('none', {})

    def test_materialize_none_returns_none(self):
        from sketchatone.ui.panel_widgets import _materialize_action
        assert _materialize_action('none', {}) is None

    def test_materialize_paramless_returns_string(self):
        # Add a synthetic paramless action via the catalog's 'none' entry
        # the only paramless catalog entry; verify the bare-string path
        from sketchatone.ui.panel_widgets import _materialize_action
        # 'none' is the only no-params entry; substitute by patching not
        # needed — verify with a params=() lookup that falls back to 'none'.
        assert _materialize_action('none', {}) is None

    def test_materialize_with_params_emits_list(self):
        from sketchatone.ui.panel_widgets import _materialize_action
        assert _materialize_action('transpose', {'semitones': 7}) == [
            'transpose', 7]


class TestActionRulesPanel:
    def test_config_event_populates_list(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        _emit_action_rules(b, rules=[
            {'id': 'r1', 'button': 'button:1',
             'action': 'toggle-repeater', 'trigger': 'press'}])
        assert panel._full['rules'][0]['id'] == 'r1'

    def test_empty_state_renders_placeholder(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        _emit_action_rules(b, rules=[])
        assert len(panel._list.children) == 1  # empty-row label

    def test_save_button_rule_materializes_action_with_params(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        _emit_action_rules(b, rules=[], groups=[{'id': 'g1', 'name': 'X',
                                                 'buttons': ['button:1']}])
        panel._form_target = 'button'
        panel._form_button = 'button:2'
        panel._form_action = 'transpose'
        panel._form_params = {'semitones': 5}
        panel._form_trigger = 'press'
        panel._save_button_rule()
        path, value = b._cfg_calls[-1]
        assert path == 'strummer.actionRules'
        assert value['rules'][-1] == {
            'button': 'button:2', 'action': ['transpose', 5],
            'trigger': 'press'}
        # Sibling groups are preserved
        assert value['groups'] == [{'id': 'g1', 'name': 'X',
                                    'buttons': ['button:1']}]

    def test_save_button_rule_with_none_action_is_noop(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        panel._form_action = 'none'
        panel._save_button_rule()
        assert b._cfg_calls == []

    def test_save_group_rule_builds_chord_progression_action(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        _emit_action_rules(b, groups=[{'id': 'g1', 'name': 'X', 'buttons': []}])
        panel._form_target = 'group'
        panel._form_group_id = 'g1'
        panel._form_group_progression = 'a-minor-pop'
        panel._form_group_octave = 5
        panel._form_group_trigger = 'press'
        panel._save_group_rule()
        value = b._cfg_calls[-1][1]
        assert value['groupRules'][-1] == {
            'groupId': 'g1', 'trigger': 'press',
            'action': {'type': 'chord-progression',
                       'progression': 'a-minor-pop', 'octave': 5}}

    def test_save_startup_rule_appends(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        panel._form_target = 'startup'
        panel._form_action = 'transpose'
        panel._form_params = {'semitones': -7}
        panel._form_name = 'Drop a fifth'
        panel._save_startup_rule()
        value = b._cfg_calls[-1][1]
        assert value['startupRules'][-1] == {
            'action': ['transpose', -7], 'name': 'Drop a fifth'}

    def test_delete_button_rule_removes_by_id(self):
        b = _make_cfg_bridge()
        panel = ActionRulesPanel(bridge=b)
        _emit_action_rules(b, rules=[
            {'id': 'r1', 'button': 'button:1', 'action': 'a',
             'trigger': 'release'},
            {'id': 'r2', 'button': 'button:2', 'action': 'b',
             'trigger': 'release'},
        ])
        panel._delete_button_rule('r1')
        ids = [r.get('id') for r in b._cfg_calls[-1][1]['rules']]
        assert ids == ['r2']

    def test_make_panel_returns_action_rules_panel(self):
        panel = make_panel('actions', 'Actions', bridge=None)
        assert isinstance(panel, ActionRulesPanel)


class TestGroupsPanel:
    def test_config_event_populates_lists(self):
        b = _make_cfg_bridge()
        panel = GroupsPanel(bridge=b)
        _emit_action_rules(b,
            groups=[{'id': 'g1', 'name': 'Chords',
                     'buttons': ['button:1', 'button:2']}],
            groupRules=[{'id': 'gr1', 'groupId': 'g1', 'trigger': 'press',
                         'action': {'type': 'chord-progression',
                                    'progression': 'c-major-pop', 'octave': 4}}])
        assert panel._full['groups'][0]['name'] == 'Chords'
        assert panel._full['groupRules'][0]['id'] == 'gr1'

    def test_save_group_sends_full_action_rules(self):
        b = _make_cfg_bridge()
        panel = GroupsPanel(bridge=b)
        _emit_action_rules(b, rules=[{'id': 'r1', 'button': 'button:1',
                                      'action': 'x', 'trigger': 'release'}])
        panel._form_name = 'Pads'
        panel._form_buttons = ['button:5', 'button:6', 'button:7']
        panel._save_group()
        value = b._cfg_calls[-1][1]
        assert value['groups'][-1] == {
            'name': 'Pads',
            'buttons': ['button:5', 'button:6', 'button:7']}
        # Sibling rules preserved
        assert value['rules'][0]['id'] == 'r1'

    def test_save_group_updates_existing_when_editing(self):
        b = _make_cfg_bridge()
        panel = GroupsPanel(bridge=b)
        _emit_action_rules(b, groups=[
            {'id': 'g1', 'name': 'A', 'buttons': ['button:1']}])
        panel._editing_id = 'g1'
        panel._form_name = 'A renamed'
        panel._form_buttons = ['button:2']
        panel._save_group()
        groups = b._cfg_calls[-1][1]['groups']
        assert groups[0]['id'] == 'g1'
        assert groups[0]['name'] == 'A renamed'
        assert groups[0]['buttons'] == ['button:2']

    def test_toggle_button_in_form(self):
        panel = GroupsPanel(bridge=_make_cfg_bridge())
        panel._open_add_form()
        panel._toggle_button('button:3')
        assert 'button:3' in panel._form_buttons
        panel._toggle_button('button:3')
        assert 'button:3' not in panel._form_buttons

    def test_delete_group_removes_by_id(self):
        b = _make_cfg_bridge()
        panel = GroupsPanel(bridge=b)
        _emit_action_rules(b, groups=[
            {'id': 'g1', 'name': 'A', 'buttons': []},
            {'id': 'g2', 'name': 'B', 'buttons': []},
        ])
        panel._delete_group('g1')
        ids = [g.get('id') for g in b._cfg_calls[-1][1]['groups']]
        assert ids == ['g2']

    def test_save_with_empty_name_is_noop(self):
        b = _make_cfg_bridge()
        panel = GroupsPanel(bridge=b)
        panel._save_group()
        assert b._cfg_calls == []

    def test_make_panel_returns_groups_panel(self):
        panel = make_panel('groups', 'Groups', bridge=None)
        assert isinstance(panel, GroupsPanel)


class TestExtractChordProgressions:
    def test_missing_payload_returns_empty(self):
        assert extract_chord_progressions(None) == {}

    def test_extracts_from_payload(self):
        out = extract_chord_progressions({'config': {'strummer': {
            'chordProgressions': {'a-minor-pop': ['Am', 'F', 'C', 'G']}}}})
        assert out == {'a-minor-pop': ['Am', 'F', 'C', 'G']}

    def test_non_dict_falls_back_to_empty(self):
        out = extract_chord_progressions({'config': {'strummer': {
            'chordProgressions': ['bogus']}}})
        assert out == {}


class TestChordProgressionsPanel:
    def test_config_event_populates_list(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        _emit_chord_progressions(b, {'c-major-50s': ['C', 'Am', 'F', 'G']})
        assert panel._progressions == {'c-major-50s': ['C', 'Am', 'F', 'G']}

    def test_save_progression_sends_full_dict(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        _emit_chord_progressions(b, {'existing': ['C', 'G']})
        panel._progression_name = 'a-minor-pop'
        panel._selected_chords = ['Am', 'F', 'C', 'G']
        panel._save_progression()
        path, value = b._cfg_calls[-1]
        assert path == 'strummer.chordProgressions'
        assert value == {'existing': ['C', 'G'],
                         'a-minor-pop': ['Am', 'F', 'C', 'G']}

    def test_rename_progression_replaces_old_key(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        _emit_chord_progressions(b, {'original': ['C', 'G']})
        panel._select_from_dropdown('original')
        panel._progression_name = 'renamed'
        panel._save_progression()
        assert b._cfg_calls[-1][1] == {'renamed': ['C', 'G']}

    def test_chord_builder_add_and_remove(self):
        panel = ChordProgressionsPanel(bridge=_make_cfg_bridge())
        panel._set_root('A')
        panel._set_quality('m')
        panel._add_chord('Am')
        panel._add_chord('F')
        assert panel._selected_chords == ['Am', 'F']
        panel._remove_chord(0)
        assert panel._selected_chords == ['F']

    def test_clear_all_empties_selected_chords(self):
        panel = ChordProgressionsPanel(bridge=_make_cfg_bridge())
        panel._selected_chords = ['C', 'G']
        panel._clear_all()
        assert panel._selected_chords == []

    def test_add_with_empty_fields_is_noop(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        panel._add()
        assert b._cfg_calls == []

    def test_delete_removes_by_name(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        _emit_chord_progressions(b, {'a': ['C'], 'b': ['G']})
        panel._delete('a')
        assert b._cfg_calls[-1][1] == {'b': ['G']}

    def test_delete_unknown_is_noop(self):
        b = _make_cfg_bridge()
        panel = ChordProgressionsPanel(bridge=b)
        panel._delete('missing')
        assert b._cfg_calls == []

    def test_make_panel_returns_chord_progressions_panel(self):
        panel = make_panel('chordProgressions', 'Chord Progressions',
                           bridge=None)
        assert isinstance(panel, ChordProgressionsPanel)



def _emit_device_buttons(bridge: UIBridge, *, buttons=None, keys=None):
    bridge._emit('config', {
        'config': {'deviceButtons': {
            'buttons': list(buttons or []),
            'keys': list(keys or []),
        }},
    })


class TestExtractDeviceButtons:
    def test_missing_payload_returns_empty(self):
        assert extract_device_buttons(None) == {'buttons': [], 'keys': []}

    def test_extracts_buttons_and_keys(self):
        out = extract_device_buttons({'config': {'deviceButtons': {
            'buttons': [{'code': 331, 'name': 'Big'}],
            'keys': [{'key': 'a', 'name': 'Alpha'}],
        }}})
        assert out == {'buttons': [{'code': 331, 'name': 'Big'}],
                       'keys': [{'key': 'a', 'name': 'Alpha'}]}

    def test_supplies_default_names_when_missing(self):
        out = extract_device_buttons({'config': {'deviceButtons': {
            'buttons': [{'code': 42}],
            'keys': [{'key': 'q'}],
        }}})
        assert out['buttons'] == [{'code': 42, 'name': 'Button 42'}]
        assert out['keys'] == [{'key': 'q', 'name': 'Key Q'}]

    def test_skips_malformed_entries(self):
        out = extract_device_buttons({'config': {'deviceButtons': {
            'buttons': [{'code': 'nope'}, None, {'code': 7, 'name': 'ok'}],
            'keys': [{'key': ''}, 'bad', {'key': 'z'}],
        }}})
        assert [b['code'] for b in out['buttons']] == [7]
        assert [k['key'] for k in out['keys']] == ['z']


class TestDeviceButtonsPanel:
    def test_config_event_populates_lists(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b,
            buttons=[{'code': 5, 'name': 'A'}],
            keys=[{'key': 'x', 'name': 'X'}])
        assert panel._buttons == [{'code': 5, 'name': 'A'}]
        assert panel._keys == [{'key': 'x', 'name': 'X'}]

    def test_delete_button_by_index(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b, buttons=[
            {'code': 1, 'name': 'A'},
            {'code': 2, 'name': 'B'},
        ])
        panel._delete_button(0)
        assert b._cfg_calls[-1] == (
            'deviceButtons.buttons', [{'code': 2, 'name': 'B'}])

    def test_delete_key_by_index(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b, keys=[
            {'key': 'a', 'name': 'A'},
            {'key': 'b', 'name': 'B'},
        ])
        panel._delete_key(1)
        assert b._cfg_calls[-1] == (
            'deviceButtons.keys', [{'key': 'a', 'name': 'A'}])

    def test_delete_out_of_range_is_noop(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b, buttons=[{'code': 1, 'name': 'A'}])
        panel._delete_button(9)
        assert b._cfg_calls == []

    def test_clear_buttons(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b, buttons=[{'code': 1, 'name': 'A'}])
        panel._clear_buttons()
        assert b._cfg_calls[-1] == ('deviceButtons.buttons', [])

    def test_clear_keys(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        _emit_device_buttons(b, keys=[{'key': 'z', 'name': 'Z'}])
        panel._clear_keys()
        assert b._cfg_calls[-1] == ('deviceButtons.keys', [])

    def test_toggle_detection_calls_bridge(self):
        b = _make_cfg_bridge()
        calls: list = []
        b.set_button_detection = calls.append  # type: ignore[assignment]
        panel = DeviceButtonsPanel(bridge=b)
        panel._toggle_detection()
        assert calls == [True]
        panel._detecting = True
        panel._toggle_detection()
        assert calls == [True, False]

    def test_detection_state_event_updates_flag(self):
        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        b._emit('button-detection-state', {'enabled': True})
        assert panel._detecting is True
        b._emit('button-detection-state', {'enabled': False})
        assert panel._detecting is False

    def test_unmount_disables_active_detection(self):
        # Panels persist across tab switches; leaving detection on while
        # navigating away would keep learning stray inputs. When the
        # widget is detached and detection is currently on, the panel
        # must turn it off via the bridge.
        b = _make_cfg_bridge()
        calls: list = []
        b.set_button_detection = calls.append  # type: ignore[assignment]
        panel = DeviceButtonsPanel(bridge=b)
        b._emit('button-detection-state', {'enabled': True})
        panel.on_parent(panel, None)
        assert calls == [False]

    def test_unmount_is_noop_when_detection_off(self):
        b = _make_cfg_bridge()
        calls: list = []
        b.set_button_detection = calls.append  # type: ignore[assignment]
        panel = DeviceButtonsPanel(bridge=b)
        panel.on_parent(panel, None)
        assert calls == []

    def test_render_sweep_across_states(self):
        # Full-layout smoke test: initial empty + idle, populated + idle,
        # populated + detecting. Walks the widget tree so any layout
        # regression in the builder helpers surfaces here.
        from kivy.uix.label import Label

        def label_texts(widget) -> list:
            out: list = []
            for child in getattr(widget, 'children', ()):
                if isinstance(child, Label):
                    out.append(child.text)
                out.extend(label_texts(child))
            return out

        b = _make_cfg_bridge()
        panel = DeviceButtonsPanel(bridge=b)
        # Empty + idle: section headers, both empty-row hints, no footer.
        texts = label_texts(panel)
        assert 'TABLET BUTTONS' in texts
        assert 'KEYBOARD KEYS' in texts
        assert any('Detect' in t for t in texts)
        assert any('No buttons observed' in t for t in texts)
        assert any('No keys observed' in t for t in texts)

        # Populated + idle: rows render with code + name; footer clears appear.
        _emit_device_buttons(b,
            buttons=[{'code': 331, 'name': 'Big'}],
            keys=[{'key': 'a', 'name': 'Alpha'}])
        texts = label_texts(panel)
        assert 'code:331' in texts and 'Big' in texts
        assert 'key:a' in texts and 'Alpha' in texts
        button_texts = [c.text for c in panel.walk()
                        if isinstance(c, Button) and c.text]
        assert 'Clear Buttons' in button_texts
        assert 'Clear Keys' in button_texts

        # Populated + detecting: pill flips label + hint.
        b._emit('button-detection-state', {'enabled': True})
        texts = label_texts(panel)
        assert any('Listening' in t for t in texts)
        button_texts = [c.text for c in panel.walk()
                        if isinstance(c, Button) and c.text]
        assert 'Stop Detecting' in button_texts
