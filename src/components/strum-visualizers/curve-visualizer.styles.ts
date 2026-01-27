import { css } from 'lit';

export const styles = css`
    :host {
        display: block;
    }

    .curve-container {
        display: flex;
        flex-direction: column;
        gap: 12px;
        padding: 8px;
    }

    .graph-container {
        width: 100%;
    }

    .graph-container svg {
        display: block;
        width: 100%;
        height: auto;
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
        color: var(--spectrum-gray-700);
        font-weight: 500;
    }

    .control-selector-top sp-picker {
        width: 100%;
    }

    .range-field {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }

    .range-label {
        font-size: 11px;
        color: var(--spectrum-gray-700);
        font-weight: 500;
    }

    .range-field sp-number-field,
    .range-field sp-picker {
        width: 100%;
    }

    .graph-bg {
        fill: var(--spectrum-gray-75);
        stroke: var(--spectrum-gray-300);
        stroke-width: 1;
    }

    .axis {
        stroke: var(--spectrum-gray-500);
        stroke-width: 1.5;
    }

    .axis-label {
        font-size: 10px;
        fill: var(--spectrum-gray-700);
    }

    .curve-line {
        fill: none;
        stroke-linecap: round;
        stroke-linejoin: round;
    }
`;
