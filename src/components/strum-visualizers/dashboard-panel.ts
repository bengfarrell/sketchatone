/**
 * Dashboard Panel
 * A collapsible, draggable panel container
 * Copied from midi-strummer project
 */

import { html, LitElement } from 'lit';
import { property, state } from 'lit/decorators.js';
import { formStyles } from '../../design-system/form-styles.js';
import '../../design-system/components/sketch-switch.js';
import { styles } from './dashboard-panel.styles.js';


export class DashboardPanel extends LitElement {
    static styles = [formStyles, styles];

    @property({ type: String })
    title = '';

    @property({ type: String })
    size: 'small' | 'medium' | 'large' | 'wide' | 'tall' | 'full' = 'medium';

    @property({ type: Boolean, reflect: true })
    hasActiveControl = false;

    @property({ type: Boolean, reflect: true })
    active = false;

    @property({ type: Boolean })
    closable = false;

    @property({ type: Boolean })
    minimizable = true;

    @property({ type: Boolean })
    draggable = true;

    @property({ type: String })
    panelId = '';

    @property({ type: Boolean })
    minimized = false;


    @state()
    private isMinimized = false;

    @state()
    private isVisible = true;

    @state()
    private isDragging = false;

    updated(changedProperties: Map<string, unknown>) {
        if (changedProperties.has('minimized')) {
            this.isMinimized = this.minimized;
        }
    }

    private handleActiveChange(e: Event) {
        const checked = (e.target as HTMLInputElement).checked;
        this.dispatchEvent(new CustomEvent('active-change', {
            detail: { active: checked },
            bubbles: true, composed: true
        }));
    }

    private toggleMinimize() {
        this.isMinimized = !this.isMinimized;
    }

    private handleClose() {
        this.isVisible = false;
        this.dispatchEvent(new CustomEvent('panel-close', {
            bubbles: true, composed: true
        }));
    }

    private handleDragStart(e: DragEvent) {
        if (!this.draggable) return;
        this.isDragging = true;
        e.dataTransfer!.effectAllowed = 'move';
        e.dataTransfer!.setData('text/plain', this.panelId);
        this.dispatchEvent(new CustomEvent('panel-drag-start', {
            detail: { panelId: this.panelId },
            bubbles: true, composed: true
        }));
    }

    private handleDragEnd() {
        this.isDragging = false;
        this.dispatchEvent(new CustomEvent('panel-drag-end', {
            bubbles: true, composed: true
        }));
    }

    private handleDragOver(e: DragEvent) {
        if (!this.draggable) return;
        e.preventDefault();
        e.dataTransfer!.dropEffect = 'move';
    }

    private handleDrop(e: DragEvent) {
        if (!this.draggable) return;
        e.preventDefault();
        const draggedPanelId = e.dataTransfer!.getData('text/plain');
        if (draggedPanelId && draggedPanelId !== this.panelId) {
            this.dispatchEvent(new CustomEvent('panel-drop', {
                detail: { draggedPanelId, targetPanelId: this.panelId },
                bubbles: true, composed: true
            }));
        }
    }

    render() {
        if (!this.isVisible) return html``;

        return html`
            <div 
                class="panel ${this.isMinimized ? 'minimized' : ''} ${this.isDragging ? 'dragging' : ''}" 
                data-size="${this.size}"
                @dragover="${this.handleDragOver}"
                @drop="${this.handleDrop}">
                ${this.title ? html`
                    <div class="panel-header">
                        <div class="header-left">
                            ${this.draggable ? html`
                                <div class="drag-handle" draggable="true"
                                    @dragstart="${this.handleDragStart}"
                                    @dragend="${this.handleDragEnd}"
                                    title="Drag to reorder">⋮⋮</div>
                            ` : ''}
                            ${this.hasActiveControl ? html`
                                <sketch-switch

                                    ?checked="${this.active}"
                                    @change="${this.handleActiveChange}"
                                    class="header-switch"
                                    size="s"
                                    title="${this.active ? 'Active' : 'Inactive'}">
                                </sketch-switch>
                            ` : ''}
                            <slot name="title"><h3 class="panel-title">${this.title}</h3></slot>
                        </div>
                        <div class="header-controls">
                            <slot name="header-actions"></slot>
                            ${this.minimizable ? html`
                                <sketch-button variant="quiet" size="xs" quiet
                                    @click="${this.toggleMinimize}"
                                    title="${this.isMinimized ? 'Maximize' : 'Minimize'}">
                                    ${this.isMinimized ? '▼' : '▲'}
                                </sketch-button>
                            ` : ''}
                            ${this.closable ? html`
                                <sketch-button variant="quiet" size="xs" quiet
                                    @click="${this.handleClose}" title="Close">✕</sketch-button>
                            ` : ''}
                        </div>
                    </div>
                ` : ''}
                <div class="panel-content">
                    <slot></slot>
                </div>
            </div>
        `;
    }
}

// Register custom element with HMR-safe check
if (!customElements.get('dashboard-panel')) {
    customElements.define('dashboard-panel', DashboardPanel);
}

declare global {
    interface HTMLElementTagNameMap {
        'dashboard-panel': DashboardPanel;
    }
}
