/**
 * Panel visibility state management for sketchatone dashboard
 */

export type PanelId =
  | 'performance'
  | 'tabletVisualizer'
  | 'stylusVisualizer'
  | 'midiInput'
  | 'midiDevices'
  | 'events'
  | 'noteVelocity'
  | 'noteDuration'
  | 'pitchBend'
  | 'strummingSettings'
  | 'strumRelease'
  | 'slide'
  | 'actions'
  | 'groups'
  | 'deviceButtons'
  | 'chordProgressions'
  | 'chordModePerformance'
  | 'serverSettings';

export interface PanelInfo {
  id: PanelId;
  label: string;
  icon: string;
}

export const PANELS: PanelInfo[] = [
  { id: 'performance', label: 'Performance', icon: '🎤' },
  { id: 'tabletVisualizer', label: 'Tablet', icon: '📱' },
  { id: 'stylusVisualizer', label: 'Stylus', icon: '✏️' },
  { id: 'midiInput', label: 'MIDI In', icon: '🎹' },
  { id: 'midiDevices', label: 'MIDI Devices', icon: '🎛️' },
  { id: 'events', label: 'Events', icon: '📋' },
  { id: 'noteVelocity', label: 'Velocity', icon: '🎚️' },
  { id: 'noteDuration', label: 'Duration', icon: '⏱️' },
  { id: 'pitchBend', label: 'Pitch', icon: '🎵' },
  { id: 'strummingSettings', label: 'Strumming', icon: '🎸' },
  { id: 'strumRelease', label: 'Release', icon: '🔔' },
  { id: 'slide', label: 'Slide', icon: '🎚️' },
  { id: 'actions', label: 'Actions', icon: '⚡' },
  { id: 'groups', label: 'Groups', icon: '📦' },
  { id: 'deviceButtons', label: 'Device Buttons', icon: '🔘' },
  { id: 'chordProgressions', label: 'Chord Progressions', icon: '🎼' },
  { id: 'chordModePerformance', label: 'Chord Mode', icon: '🎹' },
  { id: 'serverSettings', label: 'Server', icon: '⚙️' },
];

export type PanelVisibility = Record<PanelId, boolean>;

const STORAGE_KEY = 'sketchatone-panel-visibility';

const DEFAULT_VISIBILITY: PanelVisibility = {
  performance: true,
  tabletVisualizer: true,
  stylusVisualizer: true,
  midiInput: true,
  midiDevices: true,
  events: true,
  noteVelocity: true,
  noteDuration: true,
  pitchBend: true,
  strummingSettings: true,
  strumRelease: true,
  slide: true,
  actions: true,
  groups: true,
  deviceButtons: true,
  chordProgressions: true,
  chordModePerformance: true,
  serverSettings: true,
};

export function loadPanelVisibility(): PanelVisibility {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      // Merge with defaults to handle new panels
      return { ...DEFAULT_VISIBILITY, ...parsed };
    }
  } catch (e) {
    console.warn('Failed to load panel visibility:', e);
  }
  return { ...DEFAULT_VISIBILITY };
}

export function savePanelVisibility(visibility: PanelVisibility): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(visibility));
  } catch (e) {
    console.warn('Failed to save panel visibility:', e);
  }
}
