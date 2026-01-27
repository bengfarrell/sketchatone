/**
 * Curve Visualizer
 * Shows a configurable curve mapping input to output values
 * Copied from midi-strummer project
 */

import { LitElement, html, svg } from 'lit';
import { property } from 'lit/decorators.js';
import { styles } from './curve-visualizer.styles.js';

import '@spectrum-web-components/picker/sp-picker.js';
import '@spectrum-web-components/menu/sp-menu-item.js';
import '@spectrum-web-components/number-field/sp-number-field.js';

export interface CurveConfig {
    min: number;
    max: number;
    curve: number;
    spread: 'direct' | 'inverse' | 'central';
    multiplier: number;
}

export class CurveVisualizer extends LitElement {
    static styles = styles;

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

        return html`
            <div class="curve-container" style="background: #eee; padding: 16px; border-radius: 8px;">
                <div class="graph-container" style="background: white; padding: 8px;">
                    <svg viewBox="0 0 ${graphWidth} ${graphHeight}" style="width: 100%; height: auto; display: block;">
                        <rect x="${padding}" y="${padding}"
                              width="${innerWidth}" height="${innerHeight}"
                              fill="#f8f9fa" stroke="#dee2e6" stroke-width="1" />

                        <line x1="${padding}" y1="${padding}"
                              x2="${padding}" y2="${graphHeight - padding}"
                              stroke="#868e96" stroke-width="1.5" />
                        <line x1="${padding}" y1="${graphHeight - padding}"
                              x2="${graphWidth - padding}" y2="${graphHeight - padding}"
                              stroke="#868e96" stroke-width="1.5" />

                        <text x="${padding - 8}" y="${graphHeight - padding + 4}"
                              font-size="10" fill="#495057" text-anchor="end">${this.config.min.toFixed(1)}</text>
                        <text x="${padding - 8}" y="${padding + 4}"
                              font-size="10" fill="#495057" text-anchor="end">${this.config.max.toFixed(1)}</text>
                        <text x="${padding - 12}" y="${padding + innerHeight / 2}"
                              font-size="10" fill="#495057" text-anchor="middle"
                              transform="rotate(-90, ${padding - 12}, ${padding + innerHeight / 2})">${this.outputLabel}</text>

                        <polyline points="${curvePath}"
                            fill="none" stroke="${this.color}" stroke-width="2.5" stroke-linecap="round"
                            transform="translate(${padding + strokeInset}, ${padding + strokeInset})" />
                    </svg>
                </div>
                <p style="margin: 8px 0 0; font-size: 12px; color: #666;">Label: ${this.label} | Control: ${this.control}</p>
                
                <div class="controls-grid">
                    <div class="control-selector-top">
                        <label class="control-selector-label">Controlled by:</label>
                        <sp-picker size="s" value="${this.control}" @change=${this.handleControlChange}>
                            <sp-menu-item value="yaxis">Y-Axis Position</sp-menu-item>
                            <sp-menu-item value="pressure">Stylus Pressure</sp-menu-item>
                            <sp-menu-item value="tiltX">Tilt X</sp-menu-item>
                            <sp-menu-item value="tiltY">Tilt Y</sp-menu-item>
                            <sp-menu-item value="tiltXY">Tilt X+Y</sp-menu-item>
                        </sp-picker>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Spread</label>
                        <sp-picker size="s" value="${this.config.spread}" 
                            @change=${(e: Event) => this.handleConfigChange('spread', (e.target as any).value)}>
                            <sp-menu-item value="direct">Direct</sp-menu-item>
                            <sp-menu-item value="inverse">Inverse</sp-menu-item>
                            <sp-menu-item value="central">Central</sp-menu-item>
                        </sp-picker>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Min</label>
                        <sp-number-field size="s" value="${this.config.min}" step="0.1"
                            @change=${(e: Event) => this.handleConfigChange('min', parseFloat((e.target as any).value))}>
                        </sp-number-field>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Max</label>
                        <sp-number-field size="s" value="${this.config.max}" step="0.1"
                            @change=${(e: Event) => this.handleConfigChange('max', parseFloat((e.target as any).value))}>
                        </sp-number-field>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Curve</label>
                        <sp-number-field size="s" value="${this.config.curve}" step="0.1" min="0.1"
                            @change=${(e: Event) => this.handleConfigChange('curve', parseFloat((e.target as any).value))}>
                        </sp-number-field>
                    </div>
                    
                    <div class="range-field">
                        <label class="range-label">Multiplier</label>
                        <sp-number-field size="s" value="${this.config.multiplier}" step="0.1" min="0" max="2"
                            @change=${(e: Event) => this.handleConfigChange('multiplier', parseFloat((e.target as any).value))}>
                        </sp-number-field>
                    </div>
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
