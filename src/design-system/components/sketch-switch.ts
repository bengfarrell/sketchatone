/**
 * Sketchatone switch (toggle). Replaces sp-switch.
 * Emits a `change` event with `detail.checked` (and a standard `change` so existing
 * handlers reading e.target.checked still work, since we expose `.checked` on the host).
 */
import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('sketch-switch')
export class SketchSwitch extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      font-family: var(--sketch-font-sans);
      font-size: var(--sketch-font-size-md);
      color: var(--sketch-color-gray-900);
      user-select: none;
    }
    :host([disabled]) {
      cursor: not-allowed;
      opacity: 0.5;
    }

    .track {
      position: relative;
      width: 32px;
      height: 18px;
      background: var(--sketch-color-gray-300);
      border-radius: var(--sketch-radius-full);
      transition: background-color 120ms ease;
      flex: 0 0 auto;
    }
    .thumb {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 14px;
      height: 14px;
      background: #fff;
      border-radius: 50%;
      transition: transform 120ms ease;
      box-shadow: 0 1px 2px rgba(0, 0, 0, 0.2);
    }
    :host([checked]) .track {
      background: var(--sketch-color-accent-500);
    }
    :host([checked]) .thumb {
      transform: translateX(14px);
    }
    input {
      position: absolute;
      opacity: 0;
      pointer-events: none;
      width: 0;
      height: 0;
    }
    :host(:focus-within) .track {
      outline: 2px solid var(--sketch-color-focus);
      outline-offset: 2px;
    }
  `;

  @property({ type: Boolean, reflect: true })
  checked = false;

  @property({ type: Boolean, reflect: true })
  disabled = false;

  private handleClick(e: MouseEvent) {
    if (this.disabled) return;
    e.preventDefault();
    this.checked = !this.checked;
    this.dispatchEvent(new CustomEvent('change', { detail: { checked: this.checked }, bubbles: true, composed: true }));
  }

  private handleKeydown(e: KeyboardEvent) {
    if (this.disabled) return;
    if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      this.checked = !this.checked;
      this.dispatchEvent(new CustomEvent('change', { detail: { checked: this.checked }, bubbles: true, composed: true }));
    }
  }

  connectedCallback() {
    super.connectedCallback();
    if (!this.hasAttribute('role')) this.setAttribute('role', 'switch');
    if (!this.hasAttribute('tabindex')) this.setAttribute('tabindex', '0');
    this.setAttribute('aria-checked', String(this.checked));
    this.addEventListener('click', this.handleClick as EventListener);
    this.addEventListener('keydown', this.handleKeydown as EventListener);
  }

  updated() {
    this.setAttribute('aria-checked', String(this.checked));
  }

  render() {
    return html`
      <span class="track"><span class="thumb"></span></span>
      <slot></slot>
      <input type="checkbox" .checked=${this.checked} ?disabled=${this.disabled} tabindex="-1">
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketch-switch': SketchSwitch;
  }
}
