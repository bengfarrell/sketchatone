/**
 * Strum Visualizers
 * Components for visualizing and configuring strum parameters
 */

export { CurveVisualizer, type CurveConfig } from './curve-visualizer.js';
export { DashboardPanel } from './dashboard-panel.js';
export { StrumVisualizer } from './strum-visualizer.js';
export { StrumEventsDisplay, type StrumTabletEvent } from './strum-events-display.js';
export { type PianoElement, type Note } from './piano-keys.js';

// Side-effect import to register piano-keys custom element
import './piano-keys.js';
