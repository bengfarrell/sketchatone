"""
Virtual MIDI Port Helper

Detects and sets up virtual MIDI ports for integration testing.
Supports:
  - macOS: IAC Driver (built-in)
  - Linux: snd-virmidi kernel module
"""

import subprocess
import sys
from dataclasses import dataclass
from typing import Optional

try:
    import rtmidi
except ImportError:
    rtmidi = None


@dataclass
class VirtualMidiSetup:
    """Virtual MIDI setup information"""
    available: bool
    port_name: str
    platform: str
    setup_instructions: Optional[str] = None


def detect_virtual_midi() -> VirtualMidiSetup:
    """Detect and return virtual MIDI port information"""
    platform = sys.platform
    
    if platform == 'darwin':
        return _detect_macos_virtual_midi()
    elif platform.startswith('linux'):
        return _detect_linux_virtual_midi()
    else:
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='unknown',
            setup_instructions='Virtual MIDI testing is not supported on this platform'
        )


def _detect_macos_virtual_midi() -> VirtualMidiSetup:
    """Detect IAC Driver on macOS"""
    if rtmidi is None:
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='darwin',
            setup_instructions='python-rtmidi not installed. Install with: pip install python-rtmidi'
        )
    
    try:
        midi_out = rtmidi.MidiOut()
        port_count = midi_out.get_port_count()
        
        # Look for IAC Driver port
        for i in range(port_count):
            port_name = midi_out.get_port_name(i)
            if 'IAC' in port_name:
                del midi_out
                return VirtualMidiSetup(
                    available=True,
                    port_name=port_name,
                    platform='darwin'
                )
        
        del midi_out
        
        # IAC Driver exists but no ports enabled
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='darwin',
            setup_instructions="""
Virtual MIDI not available. To enable:

1. Open "Audio MIDI Setup" (in /Applications/Utilities/)
2. Window → Show MIDI Studio
3. Double-click "IAC Driver"
4. Check "Device is online"
5. Create at least one port (e.g., "Bus 1")
6. Click "Apply"

After setup, re-run tests.
            """.strip()
        )
    except Exception as e:
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='darwin',
            setup_instructions=f'Failed to detect MIDI ports: {e}'
        )


def _detect_linux_virtual_midi() -> VirtualMidiSetup:
    """Detect snd-virmidi on Linux"""
    try:
        # Check if snd-virmidi module is loaded
        result = subprocess.run(
            ['lsmod'],
            capture_output=True,
            text=True,
            check=False
        )
        
        if 'snd_virmidi' not in result.stdout:
            return VirtualMidiSetup(
                available=False,
                port_name='',
                platform='linux',
                setup_instructions="""
Virtual MIDI not available. To enable:

1. Load the snd-virmidi kernel module:
   sudo modprobe snd-virmidi

2. (Optional) Make it permanent by adding to /etc/modules:
   echo "snd-virmidi" | sudo tee -a /etc/modules

3. Check available ports:
   aplaymidi -l

After setup, re-run tests.
                """.strip()
            )
        
        # Try to find a virmidi port using aplaymidi
        try:
            result = subprocess.run(
                ['aplaymidi', '-l'],
                capture_output=True,
                text=True,
                check=False
            )
            
            for line in result.stdout.split('\n'):
                if 'Virtual Raw MIDI' in line:
                    # Extract port info
                    parts = line.strip().split()
                    if parts:
                        port_id = parts[0]
                        return VirtualMidiSetup(
                            available=True,
                            port_name=f'Virtual Raw MIDI {port_id}',
                            platform='linux'
                        )
        except FileNotFoundError:
            pass  # aplaymidi not available
        
        # Fall back to rtmidi detection
        if rtmidi is None:
            return VirtualMidiSetup(
                available=False,
                port_name='',
                platform='linux',
                setup_instructions='python-rtmidi not installed. Install with: pip install python-rtmidi'
            )
        
        midi_out = rtmidi.MidiOut()
        port_count = midi_out.get_port_count()
        
        for i in range(port_count):
            port_name = midi_out.get_port_name(i)
            if 'Virtual' in port_name or 'virmidi' in port_name:
                del midi_out
                return VirtualMidiSetup(
                    available=True,
                    port_name=port_name,
                    platform='linux'
                )
        
        del midi_out
        
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='linux',
            setup_instructions='snd-virmidi loaded but no virtual ports found'
        )
    except Exception as e:
        return VirtualMidiSetup(
            available=False,
            port_name='',
            platform='linux',
            setup_instructions=f'Failed to detect virtual MIDI: {e}'
        )


def skip_if_no_virtual_midi(setup: VirtualMidiSetup) -> bool:
    """Return True if test should be skipped (no virtual MIDI available)"""
    if not setup.available:
        print('\n⚠️  Skipping virtual MIDI tests - virtual MIDI not available')
        if setup.setup_instructions:
            print(setup.setup_instructions)
        return True
    return False
