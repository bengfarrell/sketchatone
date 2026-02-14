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

  /* Unified panel container */
  .panel {
    background: rgba(255, 255, 255, 0.02);
    border-radius: 12px;
    border: 1px solid rgba(255, 255, 255, 0.08);
    overflow: hidden;
  }

  .section-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 14px 16px;
    background: rgba(255, 255, 255, 0.03);
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .section-title {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
    font-size: 0.95em;
  }

  .rules-list {
    display: flex;
    flex-direction: column;
  }

  .rule-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 12px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .rule-item:last-child {
    border-bottom: none;
  }

  .rule-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .rule-button-id {
    min-width: 120px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.9);
  }

  .rule-arrow {
    color: rgba(255, 255, 255, 0.4);
  }

  .rule-action {
    flex: 1;
    color: rgba(255, 255, 255, 0.8);
  }

  .rule-trigger {
    padding: 2px 8px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-size: 0.8em;
    color: rgba(255, 255, 255, 0.7);
  }

  .rule-type-badge {
    padding: 2px 8px;
    border-radius: 4px;
    font-size: 0.75em;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
  }

  .rule-type-badge.button {
    background: rgba(59, 130, 246, 0.2);
    color: rgb(147, 197, 253);
  }

  .rule-type-badge.group {
    background: rgba(168, 85, 247, 0.2);
    color: rgb(216, 180, 254);
  }

  .rule-type-badge.startup {
    background: rgba(234, 179, 8, 0.2);
    color: rgb(253, 224, 71);
  }

  .rule-name {
    color: rgba(255, 255, 255, 0.5);
    font-size: 0.85em;
    font-style: italic;
  }

  .rule-actions {
    display: flex;
    gap: 4px;
  }

  .group-item {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 14px 16px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.04);
  }

  .group-item:last-child {
    border-bottom: none;
  }

  .group-item:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  .group-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .group-name {
    font-weight: 600;
    color: rgba(255, 255, 255, 0.9);
  }

  .group-details {
    display: flex;
    gap: 16px;
    color: rgba(255, 255, 255, 0.7);
    font-size: 0.9em;
  }

  .group-buttons {
    display: flex;
    gap: 6px;
    flex-wrap: wrap;
  }

  .button-chip {
    padding: 4px 10px;
    background: rgba(255, 255, 255, 0.1);
    border-radius: 4px;
    font-size: 0.85em;
    color: rgba(255, 255, 255, 0.8);
  }

  .button-chip.pressed {
    background: var(--spectrum-global-color-blue-500);
  }

  .startup-icon {
    color: rgba(255, 255, 255, 0.5);
  }

  .empty-state {
    padding: 32px 24px;
    text-align: center;
    color: rgba(255, 255, 255, 0.5);
    font-style: italic;
  }

  /* Add/Edit Form Styles */
  .form-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .form-dialog {
    background: var(--spectrum-global-color-gray-100);
    border-radius: 12px;
    padding: 24px;
    min-width: 400px;
    max-width: 500px;
    max-height: 80vh;
    overflow-y: auto;
  }

  .form-title {
    font-size: 1.2em;
    font-weight: 600;
    margin-bottom: 20px;
    color: rgba(255, 255, 255, 0.95);
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
    --spectrum-actionbutton-m-min-width: 32px;
  }
`;
