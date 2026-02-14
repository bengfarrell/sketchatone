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
    background: var(--spectrum-gray-100);
    border-radius: 12px;
    border: 1px solid var(--spectrum-gray-200);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .panel:hover {
    border-color: var(--spectrum-gray-300);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 16px;
    background: var(--spectrum-gray-200);
    border-bottom: 1px solid var(--spectrum-gray-300);
  }

  .section-title {
    font-weight: 600;
    color: var(--spectrum-gray-900);
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
    align-items: center;
    gap: 10px;
    padding: 10px 16px;
    border-bottom: 1px solid var(--spectrum-gray-200);
  }

  .rule-item:last-child {
    border-bottom: none;
  }

  .rule-item:hover {
    background: var(--spectrum-gray-100);
  }

  .rule-button-id {
    min-width: 80px;
    font-weight: 500;
    color: var(--spectrum-gray-900);
    font-size: 0.85em;
  }

  .rule-arrow {
    color: var(--spectrum-gray-500);
  }

  .rule-action {
    flex: 1;
    color: var(--spectrum-gray-800);
    font-size: 0.85em;
  }

  .rule-trigger {
    padding: 2px 8px;
    background: var(--spectrum-gray-200);
    border-radius: 4px;
    font-size: 0.75em;
    color: var(--spectrum-gray-700);
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
    background: var(--spectrum-blue-100);
    color: var(--spectrum-blue-900);
  }

  .rule-type-badge.group {
    background: var(--spectrum-purple-100);
    color: var(--spectrum-purple-900);
  }

  .rule-type-badge.startup {
    background: var(--spectrum-yellow-100);
    color: var(--spectrum-yellow-900);
  }

  .rule-name {
    color: var(--spectrum-gray-600);
    font-size: 0.8em;
    font-style: italic;
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
    border-bottom: 1px solid var(--spectrum-gray-200);
  }

  .group-item:last-child {
    border-bottom: none;
  }

  .group-item:hover {
    background: var(--spectrum-gray-100);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .group-name {
    font-weight: 600;
    color: var(--spectrum-gray-900);
    font-size: 0.9em;
  }

  .group-details {
    display: flex;
    gap: 16px;
    color: var(--spectrum-gray-700);
    font-size: 0.85em;
  }

  .group-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .button-chip {
    padding: 4px 10px;
    background: var(--spectrum-gray-200);
    border-radius: 4px;
    font-size: 0.8em;
    color: var(--spectrum-gray-800);
  }

  .button-chip.pressed {
    background: var(--spectrum-blue-400);
    color: white;
  }

  .startup-icon {
    color: var(--spectrum-gray-600);
  }

  .empty-state {
    padding: 24px 16px;
    text-align: center;
    color: var(--spectrum-gray-600);
    font-style: italic;
    font-size: 0.9em;
  }

  /* Add/Edit Form Styles */
  .form-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .form-dialog {
    background: var(--spectrum-gray-100);
    border-radius: 12px;
    padding: 24px;
    min-width: 400px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.3);
  }

  .form-title {
    font-size: 1.1em;
    font-weight: 600;
    margin-bottom: 20px;
    color: var(--spectrum-gray-900);
  }

  .form-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-bottom: 16px;
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

  .detect-button {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .detecting {
    animation: pulse 1s infinite;
  }

  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  sp-picker, sp-textfield, sp-number-field {
    width: 100%;
  }

  sp-action-button {
    --spectrum-actionbutton-m-min-width: 28px;
  }
`;
