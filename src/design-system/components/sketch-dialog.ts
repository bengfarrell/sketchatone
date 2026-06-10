/**
 * Sketchatone modal dialog. Replaces sp-dialog-wrapper.
 * Renders a centered card over a dimmed backdrop. Dispatches a `close`
 * event when the user activates the close button or clicks the underlay
 * (when `dismissable` is set).
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import './sketch-icon.js';

@customElement('sketch-dialog')
export class SketchDialog extends LitElement {
  static styles = css`
    :host {
      position: fixed;
      inset: 0;
      z-index: 1000;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: var(--sketch-font-sans);
    }

    .underlay {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
    }

    .panel {
      position: relative;
      min-width: 280px;
      max-width: min(560px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      background: var(--sketch-color-gray-50);
      color: var(--sketch-color-gray-900);
      border: 1px solid var(--sketch-color-gray-300);
      border-radius: var(--sketch-radius-md);
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.3);
      display: flex;
      flex-direction: column;
      overflow: hidden;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid var(--sketch-color-gray-200);
    }

    .headline {
      font-size: var(--sketch-font-size-lg);
      font-weight: var(--sketch-font-weight-semibold);
      line-height: 1.2;
    }

    .close {
      background: none;
      border: none;
      padding: 4px;
      color: var(--sketch-color-gray-700);
      cursor: pointer;
      border-radius: var(--sketch-radius-sm);
    }
    .close:hover { background: var(--sketch-color-gray-200); }

    .body {
      overflow: auto;
    }
  `;

  @property({ type: String })
  headline = '';

  @property({ type: Boolean, reflect: true })
  dismissable = false;

  @property({ type: Boolean, reflect: true })
  underlay = false;

  private dispatchClose() {
    this.dispatchEvent(new CustomEvent('close', { bubbles: true, composed: true }));
  }

  private onUnderlayClick = () => {
    if (this.dismissable) this.dispatchClose();
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.dismissable) {
      e.stopPropagation();
      this.dispatchClose();
    }
  };

  connectedCallback() {
    super.connectedCallback();
    document.addEventListener('keydown', this.onKey);
  }

  disconnectedCallback() {
    document.removeEventListener('keydown', this.onKey);
    super.disconnectedCallback();
  }

  render() {
    return html`
      ${this.underlay ? html`<div class="underlay" @click=${this.onUnderlayClick}></div>` : ''}
      <div class="panel" role="dialog" aria-modal="true" aria-label=${this.headline || 'dialog'}>
        <div class="header">
          <div class="headline">${this.headline}</div>
          ${this.dismissable ? html`
            <button class="close" type="button" aria-label="Close" @click=${this.dispatchClose}>
              <sketch-icon name="close"></sketch-icon>
            </button>
          ` : ''}
        </div>
        <div class="body"><slot></slot></div>
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketch-dialog': SketchDialog;
  }
}
