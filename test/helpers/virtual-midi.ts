/**
 * Virtual MIDI Port Helper
 *
 * Detects and sets up virtual MIDI ports for integration testing.
 * Supports:
 *   - macOS: IAC Driver (built-in)
 *   - Linux: snd-virmidi kernel module
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface VirtualMidiSetup {
  available: boolean;
  portName: string;
  platform: 'darwin' | 'linux' | 'win32' | 'unknown';
  setupInstructions?: string;
}

/**
 * Detect and return virtual MIDI port information
 */
export async function detectVirtualMidi(): Promise<VirtualMidiSetup> {
  const platform = process.platform;

  if (platform === 'darwin') {
    return await detectMacOSVirtualMidi();
  } else if (platform === 'linux') {
    return await detectLinuxVirtualMidi();
  } else {
    return {
      available: false,
      portName: '',
      platform: 'unknown',
      setupInstructions: 'Virtual MIDI testing is not supported on this platform'
    };
  }
}

/**
 * Detect IAC Driver on macOS
 */
async function detectMacOSVirtualMidi(): Promise<VirtualMidiSetup> {
  try {
    // Try to import @julusian/midi to check for IAC ports
    const midi = await import('@julusian/midi');
    const output = new midi.Output();
    const portCount = output.getPortCount();
    
    // Look for IAC Driver port
    for (let i = 0; i < portCount; i++) {
      const portName = output.getPortName(i);
      if (portName.includes('IAC')) {
        output.closePort();
        return {
          available: true,
          portName,
          platform: 'darwin'
        };
      }
    }
    
    output.closePort();
    
    // IAC Driver exists but no ports enabled
    return {
      available: false,
      portName: '',
      platform: 'darwin',
      setupInstructions: `
Virtual MIDI not available. To enable:

1. Open "Audio MIDI Setup" (in /Applications/Utilities/)
2. Window → Show MIDI Studio
3. Double-click "IAC Driver"
4. Check "Device is online"
5. Create at least one port (e.g., "Bus 1")
6. Click "Apply"

After setup, re-run tests.
      `.trim()
    };
  } catch (error) {
    return {
      available: false,
      portName: '',
      platform: 'darwin',
      setupInstructions: 'Failed to detect MIDI ports: ' + (error as Error).message
    };
  }
}

/**
 * Detect snd-virmidi on Linux
 */
async function detectLinuxVirtualMidi(): Promise<VirtualMidiSetup> {
  try {
    // Check if snd-virmidi module is loaded
    const { stdout } = await execAsync('lsmod | grep snd_virmidi');
    
    if (!stdout.trim()) {
      return {
        available: false,
        portName: '',
        platform: 'linux',
        setupInstructions: `
Virtual MIDI not available. To enable:

1. Load the snd-virmidi kernel module:
   sudo modprobe snd-virmidi

2. (Optional) Make it permanent by adding to /etc/modules:
   echo "snd-virmidi" | sudo tee -a /etc/modules

3. Check available ports:
   aplaymidi -l

After setup, re-run tests.
        `.trim()
      };
    }
    
    // Try to find a virmidi port using aplaymidi
    try {
      const { stdout: portsOutput } = await execAsync('aplaymidi -l 2>/dev/null');
      const lines = portsOutput.split('\n');
      
      for (const line of lines) {
        if (line.includes('Virtual Raw MIDI')) {
          // Extract port name (e.g., "20:0")
          const match = line.match(/^\s*(\d+:\d+)/);
          if (match) {
            return {
              available: true,
              portName: `Virtual Raw MIDI ${match[1]}`,
              platform: 'linux'
            };
          }
        }
      }
    } catch (e) {
      // aplaymidi not available, try rtmidi
    }
    
    // Fall back to rtmidi detection
    const midi = await import('@julusian/midi');
    const output = new midi.Output();
    const portCount = output.getPortCount();
    
    for (let i = 0; i < portCount; i++) {
      const portName = output.getPortName(i);
      if (portName.includes('Virtual') || portName.includes('virmidi')) {
        output.closePort();
        return {
          available: true,
          portName,
          platform: 'linux'
        };
      }
    }
    
    output.closePort();
    
    return {
      available: false,
      portName: '',
      platform: 'linux',
      setupInstructions: 'snd-virmidi loaded but no virtual ports found'
    };
  } catch (error) {
    return {
      available: false,
      portName: '',
      platform: 'linux',
      setupInstructions: 'Failed to detect virtual MIDI: ' + (error as Error).message
    };
  }
}

/**
 * Skip test if virtual MIDI is not available
 */
export function skipIfNoVirtualMidi(setup: VirtualMidiSetup): boolean {
  if (!setup.available) {
    console.log('\n⚠️  Skipping virtual MIDI tests - virtual MIDI not available');
    if (setup.setupInstructions) {
      console.log(setup.setupInstructions);
    }
    return true;
  }
  return false;
}
