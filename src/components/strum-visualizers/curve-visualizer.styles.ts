import { css } from 'lit';

export const styles = css`
    :host {
        display: flex;
        flex-direction: column;
        gap: 12px;
    }

    .controls-grid {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 12px 16px;
    }

    .control-selector-top {
        display: flex;
        flex-direction: column;
        gap: 4px;
        grid-column: span 2;
    }

    .control-selector-label {
        font-size: 11px;
        color: var(--sketch-color-gray-700);
        font-weight: 500;
    }

    .control-selector-top select.sketch-select {
        width: 100%;
    }

    .range-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .range-label {
        font-size: 11px;
        color: var(--sketch-color-gray-700);
        font-weight: 500;
    }

    .range-field input.sketch-input,
    .range-field select.sketch-select {
        width: 100%;
    }

    .graph-bg {
        fill: var(--sketch-color-gray-75);
        stroke: var(--sketch-color-gray-300);
        stroke-width: 1;
    }

    .axis {
        stroke: var(--sketch-color-gray-500);
        stroke-width: 1.5;
    }

    .axis-label {
        font-size: 10px;
        fill: var(--sketch-color-gray-700);
    }

    .curve-line {
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
    }

    .curve-svg {
        width: 100%;
        height: auto;
        display: block;
    }

    .curve-meta {
        font-size: 12px;
        color: var(--sketch-color-gray-700);
        margin: 0;
    }

    /* Compact layout: SVG on the left, controls on the right.
       Used by sketchatone-dashboard when running with ?compact=1 on small
       displays (e.g. 800x480 Raspberry Pi). */
    :host([compact]) {
        flex-direction: row;
        align-items: stretch;
        gap: 12px;
    }

    :host([compact]) .curve-svg {
        flex: 0 0 auto;
        width: auto;
        height: auto;
        max-height: 100%;
        max-width: 50%;
        align-self: center;
    }

    :host([compact]) .curve-meta {
        display: none;
    }

    :host([compact]) .controls-grid {
        flex: 1 1 0;
        min-width: 0;
        align-content: start;
    }
`;
