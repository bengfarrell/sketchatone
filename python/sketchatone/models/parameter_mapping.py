"""
Parameter Mapping Model

Configuration model for mapping tablet inputs to output values.
Based on midi-strummer's parameter mapping system.
"""

from dataclasses import dataclass
from typing import Optional, Dict, Any, Literal
import math


# Control sources from tablet input
ControlSource = Literal[
    "pressure",     # Pen pressure (0-1)
    "tiltX",        # Pen tilt X axis
    "tiltY",        # Pen tilt Y axis
    "tiltXY",       # Combined tilt magnitude
    "xaxis",        # X position (normalized 0-1)
    "yaxis",        # Y position (normalized 0-1)
    "velocity",     # Movement velocity
    "none"          # No control (use default)
]

# Spread types for how values are distributed
SpreadType = Literal[
    "direct",       # Linear mapping: 0→min, 1→max
    "inverse",      # Inverse mapping: 0→max, 1→min
    "central",      # Central mapping: 0.5→0, edges→±max
    "none"          # No spread, use default
]


@dataclass
class ParameterMapping:
    """
    Maps a tablet input control to an output parameter value.
    
    The mapping applies:
    1. Control source selection (pressure, tilt, position, etc.)
    2. Curve shaping (exponential/logarithmic response)
    3. Range mapping (min/max with multiplier)
    4. Spread type (direct, inverse, central)
    
    Attributes:
        min: Minimum output value
        max: Maximum output value
        multiplier: Scale factor applied to the mapped value
        curve: Curve exponent (1.0=linear, >1=exponential, <1=logarithmic)
        spread: How the input range maps to output ("direct", "inverse", "central")
        control: Input source ("pressure", "tiltX", "tiltY", "tiltXY", "xaxis", "yaxis", "velocity", "none")
        default: Default value when control is "none" or input is unavailable
    """
    min: float = 0.0
    max: float = 1.0
    multiplier: float = 1.0
    curve: float = 1.0
    spread: SpreadType = "direct"
    control: ControlSource = "none"
    default: float = 0.5
    
    def map_value(self, input_value: float) -> float:
        """
        Map an input value (0-1) to the output range.
        
        Args:
            input_value: Normalized input value (0.0 to 1.0)
            
        Returns:
            Mapped output value within [min, max] range
        """
        if self.control == "none":
            return self.default * self.multiplier
        
        # Clamp input to 0-1
        value = max(0.0, min(1.0, input_value))
        
        # Apply spread type
        if self.spread == "inverse":
            value = 1.0 - value
        elif self.spread == "central":
            # Map 0.5 to 0, edges to ±1
            value = (value - 0.5) * 2.0
        
        # Apply curve (power function)
        if self.curve != 1.0:
            if self.spread == "central":
                # Preserve sign for central spread
                sign = 1.0 if value >= 0 else -1.0
                value = sign * (abs(value) ** self.curve)
            else:
                value = value ** self.curve
        
        # Map to output range
        if self.spread == "central":
            # Central: map -1 to 1 → min to max (with 0 at center)
            center = (self.min + self.max) / 2.0
            half_range = (self.max - self.min) / 2.0
            output = center + (value * half_range)
        else:
            # Direct/Inverse: map 0 to 1 → min to max
            output = self.min + (value * (self.max - self.min))
        
        # Apply multiplier
        return output * self.multiplier
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ParameterMapping':
        """Create a ParameterMapping from a dictionary"""
        return cls(
            min=data.get('min', 0.0),
            max=data.get('max', 1.0),
            multiplier=data.get('multiplier', 1.0),
            curve=data.get('curve', 1.0),
            spread=data.get('spread', 'direct'),
            control=data.get('control', 'none'),
            default=data.get('default', 0.5)
        )
    
    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'min': self.min,
            'max': self.max,
            'multiplier': self.multiplier,
            'curve': self.curve,
            'spread': self.spread,
            'control': self.control,
            'default': self.default
        }


# Pre-configured parameter mappings matching midi-strummer defaults

def default_note_duration() -> ParameterMapping:
    """Default note duration mapping (tilt controls duration)"""
    return ParameterMapping(
        min=0.15,
        max=1.5,
        multiplier=1.0,
        curve=1.0,
        spread="inverse",
        control="tiltXY",
        default=1.0
    )


def default_pitch_bend() -> ParameterMapping:
    """Default pitch bend mapping (Y axis controls bend)"""
    return ParameterMapping(
        min=-1.0,
        max=1.0,
        multiplier=1.0,
        curve=4.0,
        spread="central",
        control="yaxis",
        default=0.0
    )


def default_note_velocity() -> ParameterMapping:
    """Default note velocity mapping (pressure controls velocity)"""
    return ParameterMapping(
        min=0,
        max=127,
        multiplier=1.0,
        curve=4.0,
        spread="direct",
        control="pressure",
        default=64
    )
