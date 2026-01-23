/**
 * MIDI module for Sketchatone
 *
 * Provides MIDI output backends and a bridge to connect Strummer events to MIDI.
 *
 * Backends:
 *   - RtMidiBackend: Uses @julusian/midi for cross-platform MIDI output
 *
 * @example
 * ```typescript
 * import { MidiStrummerBridge, RtMidiBackend } from './midi/index.js';
 *
 * // Create a MIDI backend
 * const backend = new RtMidiBackend({ channel: 0 });
 * await backend.connect();
 *
 * // Create the bridge
 * const bridge = new MidiStrummerBridge(strummer, backend);
 *
 * // Now strummer events will automatically send MIDI notes
 * ```
 */

export type { MidiBackendProtocol, MidiBackendOptions } from './protocol.js';
export { RtMidiBackend } from './rtmidi-backend.js';
export { MidiStrummerBridge, type MidiStrummerBridgeOptions } from './bridge.js';
