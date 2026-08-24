/**
 * Curve Visualizer
 * Shows a configurable curve mapping input to output values
 * Copied from midi-strummer project
 */

import { LitElement, html, svg } from 'lit';
import { property } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import { styles } from './curve-visualizer.styles.js';
import { sharedTabletInteraction } from '../../controllers/index.js';


export interface CurveConfig {
    min: number;
    max: number;
    curve: number;
    spread: 'direct' | 'inverse' | 'central';
    multiplier: number;
}

export class CurveVisualizer extends LitElement {
    static styles = [formStyles, styles];

    @property({ type: String })
    label = '';

    @property({ type: String })
    parameterKey = '';

    @property({ type: String })
    control = 'yaxis';

    @property({ type: String })
    outputLabel = 'Output';

    @property({ type: Object, hasChanged: () => true })
    config: CurveConfig = {
        min: 0,
        max: 1,
        curve: 1,
        spread: 'direct',
        multiplier: 1
    };

    @property({ type: String })
    color = '#51cf66';

    @property({ type: Number, hasChanged: () => true })
    hoverPosition: number | null = null;

    @property({ type: Boolean, reflect: true })
    compact = false;

    constructor() {
        super();
        // Register with the shared tablet interaction controller
        sharedTabletInteraction.addHost(this);
    }

    /**
     * Calculate hover position based on controller state and control type
     */
    private getHoverPositionFromController(): number | null {
        const state = sharedTabletInteraction.state;

        switch (this.control) {
            case 'yaxis':
                // Y-axis uses tablet Y position (normalized 0-1)
                // Show position even when just hovering (not pressed)
                return state.tabletY;

            case 'pressure':
                // Pressure from pen (0-1) - only show when pressed
                return state.tiltPressed ? state.tiltPressure : null;

            case 'tiltX':
                // Tilt X normalized from -1..1 to 0..1 - only show when pressed
                return state.tiltPressed ? (state.tiltX + 1) / 2 : null;

            case 'tiltY':
                // Tilt Y normalized from -1..1 to 0..1 - only show when pressed
                return state.tiltPressed ? (state.tiltY + 1) / 2 : null;

            case 'tiltXY':
                // Combined tilt magnitude with sign - use value from controller
                // Only show when pressed
                if (state.tiltPressed) {
                    // state.tiltXY ranges from -1 to +1, normalize to 0-1 for display
                    const normalized = (state.tiltXY + 1) / 2;
                    return normalized;
                }
                return null;

            default:
                return null;
        }
    }

    private handleControlChange(e: Event) {
        const target = e.target as any;
        if (target?.value) {
            this.dispatchEvent(new CustomEvent('control-change', {
                detail: { parameterKey: this.parameterKey, control: target.value },
                bubbles: true, composed: true
            }));
        }
    }

    private handleConfigChange(field: string, value: number | string) {
        this.dispatchEvent(new CustomEvent('config-change', {
            detail: { [`${this.parameterKey}.${field}`]: value },
            bubbles: true, composed: true
        }));
    }

    private calculateOutputValue(config: CurveConfig, t: number): number {
        if (config.spread === 'central') {
            const distanceFromCenter = Math.abs(t - 0.5) * 2.0;
            const curvedDistance = Math.pow(distanceFromCenter, config.curve);
            return config.max - (curvedDistance * (config.max - config.min));
        } else if (config.spread === 'inverse') {
            const curved = Math.pow(t, config.curve);
            return config.max - (curved * (config.max - config.min));
        } else {
            const curved = Math.pow(t, config.curve);
            return config.min + (curved * (config.max - config.min));
        }
    }

    private generateCurvePath(config: CurveConfig, width: number, height: number): string {
        const points: string[] = [];
        const steps = 50;
        
        for (let i = 0; i <= steps; i++) {
            const t = i / steps;
            const value = this.calculateOutputValue(config, t);
            const normalizedValue = (value - config.min) / (config.max - config.min);
            const x = t * width;
            const y = height - (normalizedValue * height);
            points.push(`${x.toFixed(2)},${y.toFixed(2)}`);
        }
        
        return points.join(' ');
    }

    render() {
        const graphWidth = 200;
        const graphHeight = 150;
        const padding = 35;
        const strokeInset = 3;
        const innerWidth = graphWidth - padding * 2;
        const innerHeight = graphHeight - padding * 2;
        const curveWidth = innerWidth - strokeInset * 2;
        const curveHeight = innerHeight - strokeInset * 2;

        const curvePath = this.generateCurvePath(this.config, curveWidth, curveHeight);

        // Get hover position from controller based on current control type
        const hoverPosition = this.getHoverPositionFromController();

        // Calculate final output value if we have a hover position
        const outputValue = hoverPosition !== null ? this.calculateOutputValue(this.config, hoverPosition) : null;

        return html`
                    <svg class="curve-svg" viewBox="0 0 ${graphWidth} ${graphHeight}">
                        <rect x="${padding}" y="${padding}"
                              width="${innerWidth}" height="${innerHeight}"
                              fill="var(--sketch-color-gray-100)" stroke="var(--sketch-color-gray-300)" stroke-width="1" />

                        <line x1="${padding}" y1="${padding}"
                              x2="${padding}" y2="${graphHeight - padding}"
                              stroke="var(--sketch-color-gray-600)" stroke-width="1.5" />
                        <line x1="${padding}" y1="${graphHeight - padding}"
                              x2="${graphWidth - padding}" y2="${graphHeight - padding}"
                              stroke="var(--sketch-color-gray-600)" stroke-width="1.5" />

                        <text x="${padding - 8}" y="${graphHeight - padding + 4}"
                              font-size="10" fill="var(--sketch-color-gray-800)" text-anchor="end">${this.config.min.toFixed(1)}</text>
                        <text x="${padding - 8}" y="${padding + 4}"
                              font-size="10" fill="var(--sketch-color-gray-800)" text-anchor="end">${this.config.max.toFixed(1)}</text>
                        <text x="${padding - 12}" y="${padding + innerHeight / 2}"
                              font-size="10" fill="var(--sketch-color-gray-800)" text-anchor="middle"
                              transform="rotate(-90, ${padding - 12}, ${padding + innerHeight / 2})">${this.outputLabel}</text>

                        <!-- Center line for central spread -->
                        ${this.config.spread === 'central' ? svg`
                            <line x1="${padding + strokeInset + curveWidth / 2}"
                                  y1="${padding}"
                                  x2="${padding + strokeInset + curveWidth / 2}"
                                  y2="${graphHeight - padding}"
                                  stroke="var(--sketch-color-notice-fg)"
                                  stroke-width="1"
                                  stroke-dasharray="3,3"
                                  opacity="0.5" />
                        ` : ''}

                        <polyline points="${curvePath}"
                            fill="none" stroke="${this.color}" stroke-width="2.5" stroke-linecap="round"
                            transform="translate(${padding + strokeInset}, ${padding + strokeInset})" />

                        <!-- Hover position indicator -->
                        ${hoverPosition !== null && outputValue !== null ? svg`
                            <line x1="${padding + strokeInset + (hoverPosition * curveWidth)}"
                                  y1="${padding}"
                                  x2="${padding + strokeInset + (hoverPosition * curveWidth)}"
                                  y2="${graphHeight - padding}"
                                  stroke="var(--sketch-color-positive-fg)"
                                  stroke-width="2"
                                  opacity="0.6"
                                  stroke-dasharray="4,4" />

                            <!-- Output value label -->
                            <text x="${padding + strokeInset + (hoverPosition * curveWidth)}"
                                  y="${padding - 8}"
                                  text-anchor="middle"
                                  font-size="11"
                                  fill="var(--sketch-color-positive-fg)"
                                  font-weight="600">
                                ${outputValue.toFixed(3)}
                            </text>
                        ` : ''}
                    </svg>
                <p class="curve-meta">Label: ${this.label} | Control: ${this.control}</p>
                
                <div class="controls-grid">
                    <div class="control-selector-top">
                        <label class="control-selector-label">Controlled by:</label>
                        <select class="sketch-select" size="s" .value=${this.control} @change=${this.handleControlChange}>
                            <option value="yaxis">Y-Axis Position</option>
                            <option value="pressure">Stylus Pressure</option>
                            <option value="tiltX">Tilt X</option>
                            <option value="tiltY">Tilt Y</option>
                            <option value="tiltXY">Tilt X+Y</option>
                            <option value="none">None (disabled)</option>
                        </select>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Spread</label>
                        <select class="sketch-select" size="s" .value=${this.config.spread}
                            @change=${(e: Event) => this.handleConfigChange('spread', (e.target as any).value)}>
                            <option value="direct">Direct</option>
                            <option value="inverse">Inverse</option>
                            <option value="central">Central</option>
                        </select>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Min</label>
                        <input type="number" class="sketch-input" size="s" .value=${this.config.min} step="0.1"
                            @change=${(e: Event) => this.handleConfigChange('min', parseFloat((e.target as any).value))}>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Max</label>
                        <input type="number" class="sketch-input" size="s" .value=${this.config.max} step="0.1"
                            @change=${(e: Event) => this.handleConfigChange('max', parseFloat((e.target as any).value))}>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Curve</label>
                        <input type="number" class="sketch-input" size="s" .value=${this.config.curve} step="0.1" min="0.1"
                            @change=${(e: Event) => this.handleConfigChange('curve', parseFloat((e.target as any).value))}>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Multiplier</label>
                        <input type="number" class="sketch-input" size="s" .value=${this.config.multiplier} step="0.1" min="0" max="2"
                            @change=${(e: Event) => this.handleConfigChange('multiplier', parseFloat((e.target as any).value))}>
                    </div>
                </div>
        `;
    }
}

// Register custom element with HMR-safe check
if (!customElements.get('curve-visualizer')) {
    customElements.define('curve-visualizer', CurveVisualizer);
}

declare global {
    interface HTMLElementTagNameMap {
        'curve-visualizer': CurveVisualizer;
    }
}
