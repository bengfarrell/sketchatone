"""
Tests for ParameterMapping model.
"""

import pytest
from sketchatone.models.parameter_mapping import (
    ParameterMapping,
    default_note_duration,
    default_pitch_bend,
    default_note_velocity
)


class TestParameterMappingBasic:
    """Test basic ParameterMapping functionality."""
    
    def test_default_values(self):
        """Test default parameter values."""
        pm = ParameterMapping()
        assert pm.min == 0.0
        assert pm.max == 1.0
        assert pm.multiplier == 1.0
        assert pm.curve == 1.0
        assert pm.spread == "direct"
        assert pm.control == "none"
        assert pm.default == 0.5
    
    def test_from_dict(self):
        """Test creating from dictionary."""
        data = {
            'min': 0.0,
            'max': 127.0,
            'multiplier': 2.0,
            'curve': 2.0,
            'spread': 'inverse',
            'control': 'pressure',
            'default': 64.0
        }
        pm = ParameterMapping.from_dict(data)
        assert pm.min == 0.0
        assert pm.max == 127.0
        assert pm.multiplier == 2.0
        assert pm.curve == 2.0
        assert pm.spread == 'inverse'
        assert pm.control == 'pressure'
        assert pm.default == 64.0
    
    def test_to_dict(self):
        """Test converting to dictionary."""
        pm = ParameterMapping(
            min=10.0,
            max=100.0,
            multiplier=1.5,
            curve=3.0,
            spread='central',
            control='tiltXY',
            default=50.0
        )
        d = pm.to_dict()
        assert d['min'] == 10.0
        assert d['max'] == 100.0
        assert d['multiplier'] == 1.5
        assert d['curve'] == 3.0
        assert d['spread'] == 'central'
        assert d['control'] == 'tiltXY'
        assert d['default'] == 50.0
    
    def test_roundtrip(self):
        """Test dict -> ParameterMapping -> dict roundtrip."""
        original = {
            'min': 0.15,
            'max': 1.5,
            'multiplier': 1.0,
            'curve': 1.0,
            'spread': 'inverse',
            'control': 'tiltXY',
            'default': 1.0
        }
        pm = ParameterMapping.from_dict(original)
        result = pm.to_dict()
        assert result == original


class TestParameterMappingMapValue:
    """Test the map_value() method."""
    
    def test_control_none_returns_default(self):
        """When control is 'none', return default * multiplier."""
        pm = ParameterMapping(control='none', default=0.75, multiplier=2.0)
        assert pm.map_value(0.0) == 1.5
        assert pm.map_value(0.5) == 1.5
        assert pm.map_value(1.0) == 1.5
    
    def test_direct_spread_linear(self):
        """Test direct spread with linear curve."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=1.0,
            curve=1.0,
            spread='direct',
            control='pressure'
        )
        assert pm.map_value(0.0) == 0.0
        assert pm.map_value(0.5) == 50.0
        assert pm.map_value(1.0) == 100.0
    
    def test_inverse_spread(self):
        """Test inverse spread (0->max, 1->min)."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=1.0,
            curve=1.0,
            spread='inverse',
            control='pressure'
        )
        assert pm.map_value(0.0) == 100.0
        assert pm.map_value(0.5) == 50.0
        assert pm.map_value(1.0) == 0.0
    
    def test_central_spread(self):
        """Test central spread (0.5->center, edges->extremes)."""
        pm = ParameterMapping(
            min=-1.0,
            max=1.0,
            multiplier=1.0,
            curve=1.0,
            spread='central',
            control='yaxis'
        )
        assert pm.map_value(0.0) == -1.0
        assert pm.map_value(0.5) == 0.0
        assert pm.map_value(1.0) == 1.0
    
    def test_exponential_curve(self):
        """Test exponential curve (curve > 1)."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=1.0,
            curve=2.0,  # Square curve
            spread='direct',
            control='pressure'
        )
        assert pm.map_value(0.0) == 0.0
        assert pm.map_value(0.5) == 25.0  # 0.5^2 * 100 = 25
        assert pm.map_value(1.0) == 100.0
    
    def test_logarithmic_curve(self):
        """Test logarithmic curve (curve < 1)."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=1.0,
            curve=0.5,  # Square root curve
            spread='direct',
            control='pressure'
        )
        assert pm.map_value(0.0) == 0.0
        assert pm.map_value(0.25) == pytest.approx(50.0)  # sqrt(0.25) * 100 = 50
        assert pm.map_value(1.0) == 100.0
    
    def test_multiplier(self):
        """Test that multiplier scales the output."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=0.5,
            curve=1.0,
            spread='direct',
            control='pressure'
        )
        assert pm.map_value(0.0) == 0.0
        assert pm.map_value(0.5) == 25.0  # 50 * 0.5
        assert pm.map_value(1.0) == 50.0  # 100 * 0.5
    
    def test_input_clamping(self):
        """Test that input values are clamped to 0-1."""
        pm = ParameterMapping(
            min=0.0,
            max=100.0,
            multiplier=1.0,
            curve=1.0,
            spread='direct',
            control='pressure'
        )
        assert pm.map_value(-0.5) == 0.0
        assert pm.map_value(1.5) == 100.0
    
    def test_central_spread_with_curve(self):
        """Test central spread with exponential curve preserves sign."""
        pm = ParameterMapping(
            min=-1.0,
            max=1.0,
            multiplier=1.0,
            curve=2.0,
            spread='central',
            control='yaxis'
        )
        # At 0.25: value = (0.25 - 0.5) * 2 = -0.5, curved = -0.25
        # output = 0 + (-0.25 * 1) = -0.25
        assert pm.map_value(0.25) == pytest.approx(-0.25)
        assert pm.map_value(0.5) == 0.0
        # At 0.75: value = (0.75 - 0.5) * 2 = 0.5, curved = 0.25
        assert pm.map_value(0.75) == pytest.approx(0.25)


class TestDefaultMappings:
    """Test the default mapping factory functions."""
    
    def test_default_note_duration(self):
        """Test default note duration mapping."""
        pm = default_note_duration()
        assert pm.min == 0.15
        assert pm.max == 1.5
        assert pm.spread == 'inverse'
        assert pm.control == 'tiltXY'
        # High tilt (1.0) -> min duration (inverse)
        assert pm.map_value(1.0) == 0.15
        # Low tilt (0.0) -> max duration
        assert pm.map_value(0.0) == 1.5
    
    def test_default_pitch_bend(self):
        """Test default pitch bend mapping."""
        pm = default_pitch_bend()
        assert pm.min == -1.0
        assert pm.max == 1.0
        assert pm.spread == 'central'
        assert pm.control == 'yaxis'
        assert pm.curve == 4.0
        # Center position -> no bend
        assert pm.map_value(0.5) == 0.0
    
    def test_default_note_velocity(self):
        """Test default note velocity mapping."""
        pm = default_note_velocity()
        assert pm.min == 0
        assert pm.max == 127
        assert pm.spread == 'direct'
        assert pm.control == 'pressure'
        assert pm.curve == 4.0
        # Full pressure -> max velocity
        assert pm.map_value(1.0) == 127.0
        # No pressure -> min velocity
        assert pm.map_value(0.0) == 0.0
