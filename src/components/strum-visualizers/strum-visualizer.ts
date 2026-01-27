/**
 * Strum Visualizer Component
 * Extends blankslate's tablet-visualizer with string visualization for strumming
 */

import { html, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { TabletVisualizer } from 'blankslate/components/tablet-visualizer/tablet-visualizer.js';

/**
 * Note object interface for string labels
 */
interface NoteObject {
    notation: string;
    octave: number;
}

/**
 * Strum Visualizer - tablet visualizer with string overlay
 */
@customElement('strum-visualizer')
export class StrumVisualizer extends TabletVisualizer {
    @property({ type: Number })
    stringCount: number = 6;

    @property({ 
        type: Array,
        hasChanged: () => true
    })
    notes: NoteObject[] = [];

    @property({ type: Number })
    externalLastPluckedString: number | null = null;

    /**
     * Render the strings overlay on the tablet surface
     */
    private renderStrings(activeAreaWidth: number, activeAreaHeight: number, activeAreaX: number, activeAreaY: number) {
        if (this.stringCount === 0) return svg``;

        const stringSpacing = activeAreaWidth / (this.stringCount + 1);

        // Button area dimensions (matching parent's renderButtons)
        const buttonRadius = 8;
        const verticalPadding = 20;
        const buttonCenterY = activeAreaY + verticalPadding + buttonRadius;
        const buttonMargin = 5;
        const stringStartY = buttonCenterY + buttonRadius + buttonMargin;

        // Leave room for labels at the bottom
        const labelHeight = 18;
        const stringEndY = activeAreaY + activeAreaHeight - labelHeight;

        // Use external last plucked string when in socket mode
        const lastPluckedString = this.socketMode ? this.externalLastPluckedString : null;

        return svg`
            ${Array.from({ length: this.stringCount }, (_, i) => {
                const stringX = activeAreaX + stringSpacing * (i + 1);

                // Get note label for this string
                const note = this.notes[i];
                const noteLabel = note ? `${note.notation}${note.octave}` : '';

                // Check if this string is the one that was just plucked
                const isPlucked = lastPluckedString === i;

                // String color changes when struck
                const strokeColor = isPlucked ? '#4ade80' : 'var(--svg-gray-700)';
                const strokeWidth = isPlucked ? 2 : 1;
                const strokeOpacity = isPlucked ? 1 : 0.5;

                return svg`
                    <!-- Visible string - non-interactive -->
                    <line
                        x1="${stringX}"
                        y1="${stringStartY}"
                        x2="${stringX}"
                        y2="${stringEndY}"
                        stroke="${strokeColor}"
                        stroke-width="${strokeWidth}"
                        opacity="${strokeOpacity}"
                        pointer-events="none" />

                    <!-- Note label at bottom of string -->
                    ${noteLabel ? svg`
                        <text
                            x="${stringX}"
                            y="${activeAreaY + activeAreaHeight - 5}"
                            text-anchor="middle"
                            font-size="10"
                            fill="${isPlucked ? '#4ade80' : 'var(--svg-gray-500)'}"
                            font-weight="${isPlucked ? '700' : '500'}"
                            pointer-events="none">
                            ${noteLabel}
                        </text>
                    ` : ''}
                `;
            })}
        `;
    }

    /**
     * Override renderTablet to include strings
     */
    protected renderTablet() {
        const tabletWidth = 240;
        const tabletHeight = 200;
        const tabletX = 20;
        const tabletY = 20;
        const activeAreaX = tabletX + 20;
        const activeAreaY = tabletY + 20;
        const activeAreaWidth = tabletWidth - 40;
        const activeAreaHeight = tabletHeight - 40;

        return html`
            <div class="tablet-container">
                <svg width="100%" height="100%"
                     viewBox="0 0 ${tabletWidth + 40} ${tabletHeight + 40}"
                     preserveAspectRatio="xMidYMid meet"
                     xmlns="http://www.w3.org/2000/svg"
                     class="tablet-svg">

                <!-- Tablet body -->
                <rect x="${tabletX}" y="${tabletY}" width="${tabletWidth}" height="${tabletHeight}"
                    class="tablet-body" rx="15"
                    pointer-events="${this.socketMode ? 'none' : 'auto'}" />

                <!-- Active area -->
                <rect x="${activeAreaX}" y="${activeAreaY}" width="${activeAreaWidth}" height="${activeAreaHeight}"
                    class="tablet-surface" rx="8"
                    pointer-events="none" />

                <!-- Strings (vertical lines) -->
                ${this.renderStrings(activeAreaWidth, activeAreaHeight, activeAreaX, activeAreaY)}

                <!-- Buttons rendered AFTER strings to appear on top -->
                ${this.renderButtons(activeAreaWidth, activeAreaX, activeAreaY)}

                <!-- Position indicator -->
                ${this.renderPositionIndicator(activeAreaX, activeAreaY, activeAreaWidth, activeAreaHeight)}
                </svg>
            </div>
        `;
    }

    /**
     * Render the position indicator dot
     */
    private renderPositionIndicator(activeAreaX: number, activeAreaY: number, activeAreaWidth: number, activeAreaHeight: number) {
        if (this.socketMode) {
            // Show position when pen is in range
            const penInRange = this.externalTabletData.x > 0 || this.externalTabletData.y > 0;
            if (!penInRange) return svg``;
            
            const isContact = this.externalTabletData.pressure > 0;
            const x = activeAreaX + (this.externalTabletData.x * activeAreaWidth);
            const y = activeAreaY + (this.externalTabletData.y * activeAreaHeight);
            
            const color = isContact ? '#ff6b6b' : '#74c0fc';
            const opacity = isContact ? Math.max(0.3, this.externalTabletData.pressure) : 0.6;
            const radius = isContact ? 12 : 8;
            
            return svg`
                <circle cx="${x}" cy="${y}" r="${radius}" 
                    fill="${color}" opacity="${opacity}" pointer-events="none" />
            `;
        }
        return svg``;
    }

    render() {
        // For strum visualizer, we only show the tablet with strings (no tilt)
        if (this.mode === 'both' || this.mode === 'tablet') {
            return html`<div class="tablet-container">${this.renderTablet()}</div>`;
        }
        
        // Fall back to parent for tilt mode
        return super.render();
    }
}

declare global {
    interface HTMLElementTagNameMap {
        'strum-visualizer': StrumVisualizer;
    }
}
