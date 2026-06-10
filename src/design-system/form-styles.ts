/**
 * Shared form-control styles. Add to a component's `static styles` tuple.
 * Classes: .sketch-input, .sketch-select, .sketch-label, .sketch-checkbox.
 */
import { css } from 'lit';

export const formStyles = css`
  .sketch-label {
    display: inline-block;
    font-family: var(--sketch-font-sans);
    font-size: var(--sketch-font-size-sm);
    font-weight: var(--sketch-font-weight-medium);
    color: var(--sketch-color-gray-800);
    line-height: 1.2;
  }

  .sketch-input,
  .sketch-select {
    font-family: var(--sketch-font-sans);
    font-size: var(--sketch-font-size-md);
    color: var(--sketch-color-gray-900);
    background: var(--sketch-color-gray-50);
    border: 1px solid var(--sketch-color-gray-300);
    border-radius: var(--sketch-radius-sm);
    padding: 0 8px;
    height: var(--sketch-control-height-md);
    line-height: 1;
    box-sizing: border-box;
    transition: border-color 100ms ease, background-color 100ms ease;
    width: 100%;
  }

  .sketch-input[size="s"],
  .sketch-select[size="s"],
  :host([compact]) .sketch-input,
  :host([compact]) .sketch-select {
    height: var(--sketch-control-height-sm);
    font-size: var(--sketch-font-size-sm);
    padding: 0 6px;
  }

  .sketch-input:focus,
  .sketch-select:focus {
    outline: none;
    border-color: var(--sketch-color-focus);
    box-shadow: 0 0 0 1px var(--sketch-color-focus);
  }

  .sketch-input:disabled,
  .sketch-select:disabled {
    background: var(--sketch-color-gray-100);
    color: var(--sketch-color-gray-500);
    cursor: not-allowed;
  }

  .sketch-input::placeholder {
    color: var(--sketch-color-gray-500);
  }

  .sketch-select {
    appearance: none;
    -webkit-appearance: none;
    background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 6' fill='currentColor'><path d='M0 0l5 6 5-6z'/></svg>");
    background-repeat: no-repeat;
    background-position: right 8px center;
    background-size: 8px 5px;
    padding-right: 24px;
  }

  .sketch-checkbox {
    width: 16px;
    height: 16px;
    accent-color: var(--sketch-color-accent-500);
    cursor: pointer;
  }
  .sketch-checkbox:disabled { cursor: not-allowed; opacity: 0.5; }
`;
