import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    width: 100%;
  }

  .config-section {
    display: flex;
    flex-direction: column;
    gap: 24px;
  }

  /* Single panel mode - panel takes full width without wrapper */
  .config-section.single-panel .panel {
    width: 100%;
  }

  /* Two-column layout for panels */
  .panels-row {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 16px;
  }

  @media (max-width: 900px) {
    .panels-row {
      grid-template-columns: 1fr;
    }
  }

  /* Unified panel container */
  .panel {
    background: var(--sketch-color-gray-100);
    border-radius: 12px;
    border: 1px solid var(--sketch-color-gray-200);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .panel:hover {
    border-color: var(--sketch-color-gray-300);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--sketch-color-gray-200);
    border-bottom: 1px solid var(--sketch-color-gray-300);
  }

  .section-title {
    font-weight: 600;
    color: var(--sketch-color-gray-900);
    font-size: 0.9em;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }

  .rules-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    overflow-y: auto;
    max-height: 400px;
  }

  .rule-item {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--sketch-color-gray-200);
  }

  .rule-top-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .rule-item:last-child {
    border-bottom: none;
  }

  .rule-item:hover {
    background: var(--sketch-color-gray-100);
  }

  /* Status dot for triggered actions */
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sketch-color-gray-300);
    flex-shrink: 0;
    transition: background-color 0.3s ease, box-shadow 0.3s ease, opacity 1s ease;
  }

  .status-dot.active {
    background: var(--sketch-color-green-500);
    box-shadow: 0 0 6px var(--sketch-color-green-500);
  }

  .status-dot.permanent {
    /* Startup rules stay lit permanently - no fade transition */
    transition: background-color 0.3s ease, box-shadow 0.3s ease;
  }

  .rule-button-id {
    min-width: 80px;
    font-weight: 500;
    color: var(--sketch-color-gray-900);
    font-size: 0.85em;
  }

  .rule-arrow {
    color: var(--sketch-color-gray-500);
  }

  .rule-action {
    color: var(--sketch-color-gray-700);
    font-size: 0.7em;
    line-height: 1.2;
    word-break: break-word;
    padding-left: 6px;
  }

  .rule-top-row .rule-actions {
    margin-left: auto;
  }

  .rule-top-row .rule-button-id {
    flex: 1;
    min-width: 0;
  }

  .rule-trigger {
    padding: 2px 8px;
    background: var(--sketch-color-gray-200);
    border-radius: 4px;
    font-size: 0.75em;
    color: var(--sketch-color-gray-700);
  }

  .rule-type-badge {
    padding: 2px 6px;
    border-radius: 4px;
    font-size: 0.7em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    flex-shrink: 0;
  }

  .rule-type-badge.button {
    background: var(--sketch-color-blue-100);
    color: var(--sketch-color-blue-900);
  }

  .rule-type-badge.group {
    background: var(--sketch-color-purple-100);
    color: var(--sketch-color-purple-900);
  }

  .rule-type-badge.startup {
    background: var(--sketch-color-yellow-100);
    color: var(--sketch-color-yellow-900);
  }

  .rule-name {
    color: var(--sketch-color-gray-600);
    font-size: 0.65em;
    line-height: 1.2;
    font-style: italic;
    word-break: break-word;
    padding-left: 6px;
  }

  .rule-actions {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }

  .group-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--sketch-color-gray-200);
  }

  .group-item:last-child {
    border-bottom: none;
  }

  .group-item:hover {
    background: var(--sketch-color-gray-100);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .group-name {
    font-weight: 600;
    color: var(--sketch-color-gray-900);
    font-size: 0.9em;
  }

  .group-details {
    display: flex;
    gap: 16px;
    color: var(--sketch-color-gray-700);
    font-size: 0.85em;
  }

  .group-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .button-chip {
    padding: 4px 10px;
    background: var(--sketch-color-gray-200);
    border-radius: 4px;
    font-size: 0.8em;
    color: var(--sketch-color-gray-800);
    transition: background-color 0.15s ease, box-shadow 0.15s ease;
  }

  /* Legacy class for backwards compatibility (used in group list display) */
  .button-chip.pressed {
    background: var(--sketch-color-blue-400);
    color: white;
  }

  /* Selected state (button is in the group) */
  .button-chip.selected {
    background: var(--sketch-color-blue-400);
    color: white;
  }

  .startup-icon {
    color: var(--sketch-color-gray-600);
  }

  .empty-state {
    padding: 24px 16px;
    text-align: center;
    color: var(--sketch-color-gray-600);
    font-style: italic;
    font-size: 0.9em;
  }

  /* Add/Edit Form Styles (inline view, not modal) */
  .form-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
  }

  .form-header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 16px;
    border-bottom: 1px solid var(--sketch-color-gray-200);
    flex-shrink: 0;
  }

  .form-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    padding: 0 16px 16px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 16px;
    align-content: start;
  }

  .form-body .form-actions {
    grid-column: 1 / -1;
  }

  .form-title {
    font-size: 1em;
    font-weight: 600;
    color: var(--sketch-color-gray-900);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 5px;
    margin-bottom: 10px;
  }

  .form-field label.sketch-label {
    margin: 0;
    padding-bottom: 0;
    line-height: 1.1;
    min-height: 0;
  }

  .form-row {
    display: flex;
    gap: 12px;
  }

  .form-row .form-field {
    flex: 1;
  }

  .form-actions {
    display: flex;
    justify-content: flex-end;
    gap: 12px;
    margin-top: 24px;
  }

  input.sketch-input, input.sketch-input {
    width: 100%;
  }

  sketch-button {
    --spectrum-actionbutton-m-min-width: 28px;
  }

  /* Native select styling to match Spectrum picker */
  .native-select {
    width: 100%;
    box-sizing: border-box;
    height: var(--sketch-control-height-md, 32px);
    padding-inline-start: var(--sketch-spacing-2, 12px);
    padding-inline-end: 28px; /* Space for dropdown arrow */
    font-family: var(--sketch-font-sans, adobe-clean, 'Source Sans Pro', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif);
    font-size: var(--sketch-font-size-md, 14px);
    font-weight: var(--sketch-font-weight-regular, 400);
    line-height: var(--sketch-line-height-md, 1.3);
    border: 1px solid var(--sketch-color-gray-400, #b3b3b3);
    border-radius: var(--sketch-radius-sm, 4px);
    background-color: var(--sketch-color-gray-75, #ffffff);
    color: var(--sketch-color-gray-800, #4b4b4b);
    cursor: pointer;
    appearance: none;
    -webkit-appearance: none;
    -moz-appearance: none;
    background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%236e6e6e' d='M5 6L0 0h10z'/%3E%3C/svg%3E");
    background-repeat: no-repeat;
    background-position: right 10px center;
    transition: border-color 130ms ease-in-out, box-shadow 130ms ease-in-out, background-color 130ms ease-in-out;
  }

  .native-select:hover {
    border-color: var(--sketch-color-gray-500, #959595);
    background-color: var(--sketch-color-gray-100, #f5f5f5);
  }

  .native-select:focus {
    outline: none;
    border-color: var(--sketch-color-blue-900, #0054b6);
    box-shadow: 0 0 0 1px var(--sketch-color-blue-900, #0054b6);
  }

  .native-select:focus-visible {
    outline: 2px solid var(--sketch-color-focus, #0054b6);
    outline-offset: 2px;
  }

  /* Dark mode support */
  @media (prefers-color-scheme: dark) {
    .native-select {
      background-color: var(--sketch-color-gray-100, #323232);
      border-color: var(--sketch-color-gray-400, #5c5c5c);
      color: var(--sketch-color-gray-800, #e1e1e1);
      background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' viewBox='0 0 10 6'%3E%3Cpath fill='%23b3b3b3' d='M5 6L0 0h10z'/%3E%3C/svg%3E");
    }

    .native-select:hover {
      background-color: var(--sketch-color-gray-200, #3e3e3e);
      border-color: var(--sketch-color-gray-500, #6e6e6e);
    }
  }
`;
