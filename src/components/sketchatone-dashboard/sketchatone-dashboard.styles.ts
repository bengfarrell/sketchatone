import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    width: 100%;
  }

  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    background: var(--spectrum-gray-50);
  }

  /* Header */
  .dashboard-header {
    display: flex;
    flex-direction: row;
    gap: 16px;
    padding: 12px 16px;
    background: var(--spectrum-gray-100);
    border-radius: 8px;
    align-items: center;
  }

  .header-logo-container {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .header-logo {
    height: 100px;
  }

  /* Theme-adaptive logo colors */
  .logo-bg {
    fill: var(--spectrum-gray-200);
  }

  .logo-title {
    fill: var(--spectrum-gray-800);
  }

  .logo-subtitle {
    fill: var(--spectrum-gray-600);
  }

  .logo-line {
    stroke: var(--spectrum-gray-500);
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
  }

  .header-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  .header-controls {
    display: flex;
    gap: 8px;
    align-items: center;
  }

  /* Connection UI */
  .connection-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }

  .connection-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-button-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-badge.connected {
    background: var(--spectrum-green-100);
    color: var(--spectrum-green-900);
  }

  .status-badge.disconnected {
    background: var(--spectrum-gray-200);
    color: var(--spectrum-gray-700);
  }

  .status-badge.disconnected .status-dot {
    background: var(--spectrum-gray-500);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--spectrum-green-600);
  }

  /* Version Info */
  .version-info {
    display: flex;
    gap: 16px;
    justify-content: flex-end;
    font-size: 0.7rem;
    color: var(--spectrum-gray-500);
    margin-top: 4px;
  }

  .version-label {
    font-family: monospace;
  }

  /* Disconnected Message */
  .disconnected-message {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px 24px;
    color: var(--spectrum-gray-600);
    font-size: 1rem;
  }

  .disconnected-message p {
    margin: 0;
  }

  /* Panels Grid - main layout for all panels */
  .panels-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 16px;
  }

  @media (max-width: 1024px) {
    .panels-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .panels-grid {
      grid-template-columns: 1fr;
    }
  }

  /* MIDI Panel Content */
  .midi-panel-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .midi-status-row {
    display: flex;
    justify-content: flex-start;
  }

  /* Strum Main Visualizer */
  .strum-main-visualizer {
    margin-bottom: 16px;
  }

  .strum-visualizer-wrapper {
    display: flex;
    justify-content: center;
    padding: 16px;
  }

  .strum-visualizer-wrapper tablet-visualizer {
    max-width: 600px;
    width: 100%;
  }

  /* Piano styling */
  piano-keys {
    width: 100%;
    max-width: 100%;
  }

  /* Settings Grid - matches visualizers-grid sizing */
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  @media (max-width: 1024px) {
    .settings-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Settings Form */
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-row label {
    font-size: 0.875rem;
    color: var(--spectrum-gray-700);
    flex-shrink: 0;
  }

  .setting-row sp-number-field {
    width: 100px;
  }

  .setting-row sp-picker {
    flex: 1;
    min-width: 150px;
  }

  .setting-row sp-checkbox {
    margin: 0;
  }

  /* Chord Progression */
  .chord-progression {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .preset-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .preset-row sp-picker {
    flex: 1;
  }

  .chord-buttons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .chord-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 8px;
    background: var(--spectrum-gray-100);
    border: 2px solid var(--spectrum-gray-300);
    border-radius: 8px;
    transition: all 0.15s ease;
  }

  .chord-button.active {
    background: var(--spectrum-green-100);
    border-color: var(--spectrum-green-600);
  }

  .chord-button .button-number {
    font-size: 0.7rem;
    color: var(--spectrum-gray-600);
    margin-bottom: 4px;
  }

  .chord-button .chord-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--spectrum-gray-900);
  }

  .chord-button.active .chord-name {
    color: var(--spectrum-green-800);
  }

  /* Placeholder */
  .placeholder-visualizer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    background: var(--spectrum-gray-75);
    border-radius: 8px;
    border: 2px dashed var(--spectrum-gray-300);
  }

  .placeholder-visualizer p {
    margin: 0;
    font-size: 1.25rem;
    color: var(--spectrum-gray-700);
  }

  .placeholder-hint {
    font-size: 0.875rem !important;
    color: var(--spectrum-gray-500) !important;
    margin-top: 8px !important;
  }

  /* Visualizers Grid */
  .visualizers-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .visualizer-card {
    background: var(--spectrum-gray-100);
    border-radius: 12px;
    border: 1px solid var(--spectrum-gray-200);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .visualizer-card:hover {
    border-color: var(--spectrum-gray-300);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }

  .visualizer-card.compact {
    padding: 12px;
  }

  .visualizer-wrapper {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .events-panel {
    grid-row: span 1;
  }

  .bytes-panel {
    grid-column: span 3;
  }

  /* Data Values */
  .data-values {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .data-values.compact {
    gap: 4px;
  }

  .data-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--spectrum-gray-100);
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .data-label {
    color: var(--spectrum-gray-600);
    font-weight: 500;
  }

  .data-value {
    color: var(--spectrum-gray-900);
    font-family: monospace;
  }

  .data-value.zero {
    color: var(--spectrum-gray-400);
  }

  /* Responsive */
  @media (max-width: 1024px) {
    .visualizers-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .bytes-panel {
      grid-column: span 2;
    }
  }

  @media (max-width: 640px) {
    .visualizers-grid {
      grid-template-columns: 1fr;
    }

    .bytes-panel {
      grid-column: span 1;
    }

  }

  /* MIDI Input Panel (inside visualizers-grid) */
  .visualizer-card.midi-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .midi-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .midi-panel-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--spectrum-gray-900);
  }

  .status-badge.small {
    font-size: 0.8rem;
    padding: 3px 8px;
  }

  .midi-notes {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--spectrum-blue-100);
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .midi-notes.compact {
    padding: 6px 10px;
    font-size: 0.875rem;
  }

  .midi-notes-label {
    color: var(--spectrum-blue-900);
    font-weight: 500;
  }

  .midi-notes-value {
    color: var(--spectrum-blue-900);
    font-family: monospace;
    font-weight: 600;
  }

  .midi-source {
    font-size: 0.8rem;
    color: var(--spectrum-gray-700);
    font-style: italic;
  }

  .midi-ports-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .midi-ports-label {
    font-size: 0.875rem;
    color: var(--spectrum-gray-800);
  }

  .midi-ports {
    list-style: none;
    margin: 6px 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 150px;
    overflow-y: auto;
  }

  .midi-port-item {
    padding: 6px 10px;
    background: var(--spectrum-gray-200);
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--spectrum-gray-900);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .midi-port-item:hover {
    background: var(--spectrum-gray-300);
  }

  .midi-port-item.selected {
    background: var(--spectrum-blue-200);
    border-left: 3px solid var(--spectrum-blue-700);
    color: var(--spectrum-blue-900);
    font-weight: 600;
  }

  .midi-port-item.active {
    background: var(--spectrum-green-200);
    border-left: 3px solid var(--spectrum-green-700);
    color: var(--spectrum-green-900);
  }

  .midi-port-item.selected.active {
    background: var(--spectrum-green-200);
    border-left: 3px solid var(--spectrum-blue-700);
  }
`;
