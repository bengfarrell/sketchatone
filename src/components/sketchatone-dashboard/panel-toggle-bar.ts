/**
 * Panel Toggle Bar
 * A horizontal bar showing all available panels with toggle icons
 */

import { html, LitElement, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { PANELS, PanelId, PanelVisibility } from './panel-visibility.js';

@customElement('panel-toggle-bar')
export class PanelToggleBar extends LitElement {
  static styles = css`
    :host {
      display: block;
      width: 100%;
    }

    .toggle-bar {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      padding: 12px 16px;
      background: var(--spectrum-gray-100);
      border-radius: 12px;
      border: 1px solid var(--spectrum-gray-200);
      box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    }

    .toggle-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      border-radius: 6px;
      border: 1px solid var(--spectrum-gray-300);
      background: var(--spectrum-gray-75);
      cursor: pointer;
      transition: all 0.15s ease;
      font-size: 0.8rem;
      font-weight: 500;
      color: var(--spectrum-gray-700);
      user-select: none;
    }

    .toggle-item:hover {
      background: var(--spectrum-gray-100);
      border-color: var(--spectrum-gray-400);
    }

    .toggle-item.visible {
      background: var(--spectrum-gray-200);
      border-color: var(--spectrum-gray-400);
      color: var(--spectrum-gray-900);
    }

    .toggle-item:not(.visible) {
      opacity: 0.6;
    }

    .toggle-label {
      white-space: nowrap;
    }

    .visibility-indicator {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: var(--spectrum-gray-400);
      transition: background 0.15s ease;
    }

    .toggle-item.visible .visibility-indicator {
      background: var(--spectrum-positive-color-900);
    }
  `;

  @property({ type: Object })
  visibility: PanelVisibility = {} as PanelVisibility;

  private handleToggle(panelId: PanelId) {
    this.dispatchEvent(new CustomEvent('panel-toggle', {
      detail: { panelId, visible: !this.visibility[panelId] },
      bubbles: true,
      composed: true
    }));
  }

  render() {
    return html`
      <div class="toggle-bar">
        ${PANELS.map(panel => html`
          <button
            class="toggle-item ${this.visibility[panel.id] ? 'visible' : ''}"
            @click=${() => this.handleToggle(panel.id)}
            title="${panel.label}: ${this.visibility[panel.id] ? 'Visible' : 'Hidden'}"
          >
            <span class="toggle-label">${panel.label}</span>
            <span class="visibility-indicator"></span>
          </button>
        `)}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'panel-toggle-bar': PanelToggleBar;
  }
}
