"""
Integration tests for config loading via CLI

These tests verify that config files are correctly loaded and parsed
by running the CLI with --dump-config and checking the output.
"""

import json
import subprocess
import sys
from pathlib import Path

import pytest

# Get paths
TESTS_DIR = Path(__file__).parent.parent
FIXTURES_DIR = TESTS_DIR / "fixtures"
PYTHON_DIR = TESTS_DIR.parent


def dump_config(config_path: Path) -> dict:
    """Run the CLI with --dump-config and return parsed JSON"""
    result = subprocess.run(
        [sys.executable, "-m", "sketchatone.cli.server", "-c", str(config_path), "--dump-config"],
        capture_output=True,
        text=True,
        cwd=str(PYTHON_DIR),
    )
    if result.returncode != 0:
        raise RuntimeError(f"CLI failed: {result.stderr}")
    
    # Parse JSON from stdout (skip any warning lines)
    lines = result.stdout.strip().split('\n')
    json_start = next(i for i, line in enumerate(lines) if line.strip().startswith('{'))
    json_text = '\n'.join(lines[json_start:])
    return json.loads(json_text)


class TestFlatFormatConfig:
    """Tests for flat format config (snake_case keys)"""
    
    @pytest.fixture
    def config(self):
        return dump_config(FIXTURES_DIR / "config-flat-format.json")
    
    def test_load_config_without_errors(self, config):
        assert config is not None
        assert "strummer" in config
        assert "midi" in config
        assert "server" in config
    
    def test_note_duration_settings(self, config):
        note_duration = config["strummer"]["noteDuration"]
        assert note_duration["min"] == 0.2
        assert note_duration["max"] == 2.0
        assert note_duration["multiplier"] == 1.5
        assert note_duration["curve"] == 2.5
        assert note_duration["spread"] == "inverse"
        assert note_duration["control"] == "tiltXY"
        assert note_duration["default"] == 0.8
    
    def test_pitch_bend_settings(self, config):
        pitch_bend = config["strummer"]["pitchBend"]
        assert pitch_bend["min"] == -0.5
        assert pitch_bend["max"] == 0.5
        assert pitch_bend["multiplier"] == 0.8
        assert pitch_bend["curve"] == 3.0
        assert pitch_bend["spread"] == "central"
        assert pitch_bend["control"] == "yaxis"
    
    def test_note_velocity_settings(self, config):
        note_velocity = config["strummer"]["noteVelocity"]
        assert note_velocity["min"] == 10
        assert note_velocity["max"] == 100
        assert note_velocity["multiplier"] == 1.2
        assert note_velocity["curve"] == 2.0
        assert note_velocity["spread"] == "direct"
    
    def test_strumming_settings(self, config):
        strumming = config["strummer"]["strumming"]
        assert strumming["pluckVelocityScale"] == 3.5
        assert strumming["pressureThreshold"] == 0.15
        assert strumming["midiChannel"] == 2
        assert strumming["initialNotes"] == ["D4", "F#4", "A4"]
        assert strumming["chord"] == "Dm"
        assert strumming["upperNoteSpread"] == 4
        assert strumming["lowerNoteSpread"] == 2
    
    def test_note_repeater_settings(self, config):
        note_repeater = config["strummer"]["noteRepeater"]
        assert note_repeater["active"] is True
        assert note_repeater["pressureMultiplier"] == 2.0
        assert note_repeater["frequencyMultiplier"] == 1.5
    
    def test_transpose_settings(self, config):
        transpose = config["strummer"]["transpose"]
        assert transpose["active"] is True
        assert transpose["semitones"] == 7
    
    def test_stylus_buttons_settings(self, config):
        stylus_buttons = config["strummer"]["stylusButtons"]
        assert stylus_buttons["active"] is False
        assert stylus_buttons["primaryButtonAction"] == "toggle-repeater"
        assert stylus_buttons["secondaryButtonAction"] == "toggle-transpose"
    
    def test_strum_release_settings(self, config):
        strum_release = config["strummer"]["strumRelease"]
        assert strum_release["active"] is True
        assert strum_release["midiNote"] == 42
        assert strum_release["midiChannel"] == 3
        assert strum_release["maxDuration"] == 0.5
        assert strum_release["velocityMultiplier"] == 0.8
    
    def test_tablet_buttons_settings(self, config):
        tablet_buttons = config["strummer"]["tabletButtons"]
        assert tablet_buttons["preset"] == "jazz-standards"
        assert tablet_buttons["chords"] == ["Dm7", "G7", "Cmaj7", "Fmaj7"]
        assert tablet_buttons["currentIndex"] == 2
    
    def test_midi_settings(self, config):
        midi = config["midi"]
        # Python MidiConfig has different fields than Node.js
        # It uses midiOutputBackend, midiOutputId, etc. instead of outputPort, channel, etc.
        assert "midiOutputBackend" in midi
        assert "midiOutputId" in midi
        assert "jackClientName" in midi
    
    def test_server_settings(self, config):
        server = config["server"]
        assert server["device"] == "devices"
        assert server["httpPort"] == 3000
        assert server["wsPort"] == 9000
        assert server["wsMessageThrottle"] == 200
        assert server["deviceFindingPollInterval"] == 3000


class TestNestedFormatConfig:
    """Tests for nested format config (camelCase keys with strummer wrapper)"""
    
    @pytest.fixture
    def config(self):
        return dump_config(FIXTURES_DIR / "config-nested-format.json")
    
    def test_load_config_without_errors(self, config):
        assert config is not None
        assert "strummer" in config
    
    def test_note_duration_settings(self, config):
        note_duration = config["strummer"]["noteDuration"]
        assert note_duration["min"] == 0.3
        assert note_duration["max"] == 1.8
        assert note_duration["curve"] == 1.5
        assert note_duration["spread"] == "direct"
        assert note_duration["control"] == "pressure"
    
    def test_note_repeater_settings(self, config):
        note_repeater = config["strummer"]["noteRepeater"]
        assert note_repeater["active"] is False
        assert note_repeater["pressureMultiplier"] == 3.0
        assert note_repeater["frequencyMultiplier"] == 2.0
    
    def test_transpose_settings(self, config):
        transpose = config["strummer"]["transpose"]
        assert transpose["active"] is False
        assert transpose["semitones"] == -5
    
    def test_stylus_buttons_settings(self, config):
        stylus_buttons = config["strummer"]["stylusButtons"]
        assert stylus_buttons["active"] is True
        assert stylus_buttons["primaryButtonAction"] == "none"
        assert stylus_buttons["secondaryButtonAction"] == "toggle-repeater"
    
    def test_midi_settings(self, config):
        midi = config["midi"]
        # Python MidiConfig has different fields than Node.js
        assert "midiOutputBackend" in midi
        assert "midiOutputId" in midi
        assert "jackClientName" in midi
    
    def test_server_settings(self, config):
        server = config["server"]
        assert server["device"] == "/opt/sketchatone/configs/devices"
        assert server["httpPort"] == 4000
        assert server["wsPort"] == 9500
        assert server["wsMessageThrottle"] == 100
        assert server["deviceFindingPollInterval"] == 5000
