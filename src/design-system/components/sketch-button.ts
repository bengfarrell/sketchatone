/**
 * Sketchatone button. Replaces sp-button and sp-action-button.
 * Variants: primary | secondary | accent | quiet
 * Sizes:    xs | s | m
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('sketch-button')
export class SketchButton extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      vertical-align: middle;
    }
    :host([hidden]) { display: none; }

    button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 0 12px;
      height: var(--sketch-control-height-md);
      font-family: var(--sketch-font-sans);
      font-size: var(--sketch-font-size-md);
      font-weight: var(--sketch-font-weight-medium);
      line-height: 1;
      border: 1px solid transparent;
      border-radius: var(--sketch-radius-sm);
      background: transparent;
      color: var(--sketch-color-gray-900);
      cursor: pointer;
      transition: background-color 100ms ease, border-color 100ms ease, color 100ms ease;
      white-space: nowrap;
    }
    button:focus-visible {
      outline: 2px solid var(--sketch-color-focus);
      outline-offset: 1px;
    }
    button:disabled {
      cursor: not-allowed;
      opacity: 0.5;
    }

    :host([size="s"]) button { height: var(--sketch-control-height-sm); padding: 0 10px; font-size: var(--sketch-font-size-sm); }
    :host([size="xs"]) button { height: 20px; padding: 0 6px; font-size: var(--sketch-font-size-sm); }
    :host([size="m"]) button { height: var(--sketch-control-height-md); }

    :host([variant="primary"]) button {
      background: var(--sketch-color-gray-900);
      color: var(--sketch-color-gray-50);
      border-color: var(--sketch-color-gray-900);
    }
    :host([variant="primary"]) button:hover:not(:disabled) {
      background: var(--sketch-color-gray-800);
      border-color: var(--sketch-color-gray-800);
    }

    :host([variant="accent"]) button {
      background: var(--sketch-color-accent-500);
      color: #fff;
      border-color: var(--sketch-color-accent-500);
    }
    :host([variant="accent"]) button:hover:not(:disabled) {
      background: var(--sketch-color-blue-600);
      border-color: var(--sketch-color-blue-600);
    }

    :host([variant="secondary"]) button {
      background: transparent;
      color: var(--sketch-color-gray-900);
      border-color: var(--sketch-color-gray-400);
    }
    :host([variant="secondary"]) button:hover:not(:disabled) {
      background: var(--sketch-color-gray-100);
      border-color: var(--sketch-color-gray-500);
    }

    :host([variant="quiet"]) button {
      background: transparent;
      color: var(--sketch-color-gray-800);
      border-color: transparent;
      padding: 0 8px;
    }
    :host([variant="quiet"][size="s"]) button { padding: 0 6px; }
    :host([variant="quiet"][size="xs"]) button { padding: 0 4px; }
    :host([variant="quiet"]) button:hover:not(:disabled) {
      background: var(--sketch-color-gray-200);
    }

    /* When only an icon is slotted (no text), make it square */
    :host([icon-only]) button { padding: 0; aspect-ratio: 1; }
    :host([icon-only][size="s"]) button { width: var(--sketch-control-height-sm); }
    :host([icon-only][size="xs"]) button { width: 20px; }

    ::slotted([slot="icon"]) {
      width: 1em;
      height: 1em;
      flex: 0 0 auto;
    }
  `;

  @property({ type: String, reflect: true })
  variant: 'primary' | 'secondary' | 'accent' | 'quiet' = 'secondary';

  @property({ type: String, reflect: true })
  size: 'xs' | 's' | 'm' = 'm';

  @property({ type: Boolean, reflect: true })
  disabled = false;

  @property({ type: Boolean, reflect: true, attribute: 'icon-only' })
  iconOnly = false;

  @property({ type: String })
  type: 'button' | 'submit' | 'reset' = 'button';

  @property({ type: String })
  title = '';

  protected firstUpdated() {
    // Auto-detect icon-only: if the default slot has no text content but icon slot has children.
    requestAnimationFrame(() => {
      const defaultSlot = this.shadowRoot?.querySelector('slot:not([name])') as HTMLSlotElement | null;
      const text = defaultSlot?.assignedNodes().map(n => n.textContent ?? '').join('').trim() ?? '';
      const hasIcon = !!this.querySelector('[slot="icon"]');
      if (!text && hasIcon) this.iconOnly = true;
    });
  }

  render() {
    return html`
      <button type=${this.type} ?disabled=${this.disabled} title=${this.title}>
        <slot name="icon"></slot>
        <slot></slot>
      </button>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketch-button': SketchButton;
  }
}
