import { css } from 'lit';

// Import and extend the dashboard styles
import { styles as dashboardStyles } from '../sketchatone-dashboard/sketchatone-dashboard.styles.js';

export const styles = [
  dashboardStyles,
  css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .app {
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      background: var(--spectrum-gray-100);
    }

    .nav-bar {
      padding: 16px 24px;
      background: var(--spectrum-gray-50);
      backdrop-filter: blur(10px);
      border-bottom: 1px solid var(--spectrum-gray-300);
      position: sticky;
      top: 0;
      z-index: 100;
    }

    .page-content {
      flex: 1;
      max-width: 1400px;
      margin: 0 auto;
      padding: 30px;
      width: 100%;
      box-sizing: border-box;
    }

    /* WebHID Connection Panel */
    .hid-connection-panel {
      display: flex;
      flex-direction: column;
      gap: 12px;
      padding: 16px;
      background: var(--spectrum-gray-100);
      border-radius: 8px;
      margin-bottom: 16px;
    }

    .hid-connection-row {
      display: flex;
      align-items: center;
      gap: 12px;
      flex-wrap: wrap;
    }

    .hid-status {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    /* MIDI Output Panel */
    .midi-output-panel {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      background: var(--spectrum-gray-75);
      border-radius: 8px;
    }

    .midi-output-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .midi-output-title {
      font-size: 0.875rem;
      font-weight: 600;
      color: var(--spectrum-gray-800);
    }

    .midi-output-ports {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }

    .midi-output-port {
      padding: 6px 10px;
      background: var(--spectrum-gray-200);
      border-radius: 4px;
      font-family: monospace;
      font-size: 0.8rem;
      color: var(--spectrum-gray-900);
      cursor: pointer;
      transition: background 0.15s ease;
    }

    .midi-output-port:hover {
      background: var(--spectrum-gray-300);
    }

    .midi-output-port.active {
      background: var(--spectrum-green-200);
      border-left: 3px solid var(--spectrum-green-700);
    }

    /* Config file selector */
    .config-selector {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .config-file-input {
      display: none;
    }

    /* Active features indicator */
    .active-features {
      display: flex;
      gap: 8px;
      flex-wrap: wrap;
    }

    .feature-badge {
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 0.7rem;
      font-weight: 500;
      background: var(--spectrum-gray-200);
      color: var(--spectrum-gray-700);
    }

    .feature-badge.active {
      background: var(--spectrum-green-100);
      color: var(--spectrum-green-900);
    }

    /* Chord selector */
    .chord-selector {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    .chord-input-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .chord-presets {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .chord-preset-btn {
      padding: 6px 12px;
      background: var(--spectrum-gray-200);
      border: 1px solid var(--spectrum-gray-300);
      border-radius: 4px;
      font-size: 0.8rem;
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .chord-preset-btn:hover {
      background: var(--spectrum-gray-300);
    }

    .chord-preset-btn.active {
      background: var(--spectrum-accent-color-100);
      border-color: var(--spectrum-accent-color-500);
      color: var(--spectrum-accent-color-900);
    }
  `
];
