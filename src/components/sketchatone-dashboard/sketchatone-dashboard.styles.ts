import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    width: 100%;
    min-height: 100vh;
  }

  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    background: var(--spectrum-gray-50);
    min-height: 100vh;
  }

  /* Header */
  .dashboard-header {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 12px 16px;
    background: var(--spectrum-gray-100);
    border-radius: 8px;
  }

  .header-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .header-info h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 600;
    color: var(--spectrum-gray-900);
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
  }

  .connection-group {
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

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--spectrum-green-600);
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

  /* Collapsible Sections */
  .visualizer-section {
    background: var(--spectrum-gray-100);
    border-radius: 8px;
    overflow: hidden;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    padding: 12px 16px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    color: var(--spectrum-gray-800);
    text-align: left;
  }

  .section-header:hover {
    background: var(--spectrum-gray-200);
  }

  .section-toggle {
    font-size: 0.75rem;
    color: var(--spectrum-gray-600);
  }

  .section-content {
    padding: 16px;
    border-top: 1px solid var(--spectrum-gray-200);
    display: flex;
    flex-direction: column;
    gap: 16px;
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

  /* Settings Grid */
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 12px;
  }

  @media (max-width: 1400px) {
    .settings-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 800px) {
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
    background: var(--spectrum-gray-75);
    border-radius: 8px;
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
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
`;
