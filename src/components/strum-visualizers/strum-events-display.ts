/**
 * Strum Events Display Component
 * Extends blankslate's events-display with strum event visualization
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import type { TabletEvent } from 'blankslate/components/events-display/events-display.js';
import type { StrumEventData } from '../../types/tablet-events.js';

/**
 * Extended event interface that includes strum data
 */
export interface StrumTabletEvent extends TabletEvent {
  strum?: StrumEventData;
}

export interface EventsDeviceInfo {
  packetCount?: number;
  isMock?: boolean;
  isTranslated?: boolean;
}

/**
 * Strum Events Display - shows tablet events plus strum events
 */
@customElement('strum-events-display')
export class StrumEventsDisplay extends LitElement {
  static styles = css`
    :host {
      display: block;
      height: 100%;
    }

    .events-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      gap: 10px;
    }

    .events-container.empty {
      justify-content: center;
      align-items: center;
    }

    .empty-state {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      color: var(--spectrum-gray-500);
      text-align: center;
    }

    .empty-icon {
      font-size: 2rem;
      margin-bottom: 8px;
      opacity: 0.5;
    }

    .empty-state p {
      margin: 0;
      font-size: 0.85rem;
    }

    .event-header {
      display: flex;
      align-items: baseline;
      gap: 6px;
    }

    .event-count {
      font-size: 1.25rem;
      font-weight: 700;
      color: var(--spectrum-gray-900);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .event-label {
      font-size: 0.75rem;
      color: var(--spectrum-gray-600);
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .header-badges {
      display: flex;
      gap: 6px;
      margin-left: auto;
    }

    .source-badge {
      padding: 2px 8px;
      border-radius: 4px;
      font-size: 0.65rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
    }

    .source-badge.mock {
      background: var(--spectrum-gray-300);
      color: var(--spectrum-gray-800);
    }

    .source-badge.translated {
      background: var(--spectrum-notice-background-color-default);
      color: var(--spectrum-notice-content-color-default);
    }

    .event-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 6px 8px;
    }

    .event-field {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .field-label {
      font-size: 0.65rem;
      color: var(--spectrum-gray-600);
      text-transform: uppercase;
      letter-spacing: 0.05em;
      font-weight: 500;
    }

    .field-value {
      font-size: 0.85rem;
      font-weight: 600;
      color: var(--spectrum-gray-900);
      font-family: 'JetBrains Mono', 'Fira Code', monospace;
    }

    .button-status {
      display: flex;
      gap: 8px;
      padding-top: 8px;
      border-top: 1px solid var(--spectrum-gray-200);
    }

    .button-indicator {
      flex: 1;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px;
      border-radius: 6px;
      background: var(--spectrum-gray-200);
      transition: all 0.15s ease;
    }

    .button-indicator.active {
      background: var(--spectrum-positive-color-900);
    }

    .button-indicator.active .button-label {
      color: var(--spectrum-gray-50);
    }

    .button-label {
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      color: var(--spectrum-gray-700);
    }

    /* Strum-specific styles */
    .strum-section {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--spectrum-gray-300);
    }

    .strum-header {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }

    .strum-label {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--spectrum-gray-600);
    }

    .strum-type {
      font-size: 10px;
      padding: 2px 6px;
      border-radius: 4px;
      font-weight: 600;
    }

    .strum-type.strum {
      background: var(--spectrum-positive-background-color-default);
      color: var(--spectrum-positive-content-color-default);
    }

    .strum-type.release {
      background: var(--spectrum-notice-background-color-default);
      color: var(--spectrum-notice-content-color-default);
    }

    .strum-notes {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
    }

    .note-chip {
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 8px;
      background: var(--spectrum-gray-100);
      border: 1px solid var(--spectrum-gray-300);
      border-radius: 6px;
      font-size: 12px;
    }

    .note-name {
      font-weight: 600;
      color: var(--spectrum-gray-900);
    }

    .note-velocity {
      font-size: 10px;
      color: var(--spectrum-gray-600);
    }

    .no-strum {
      font-size: 12px;
      color: var(--spectrum-gray-500);
      font-style: italic;
    }

    .strum-velocity {
      margin-top: 6px;
      font-size: 11px;
      color: var(--spectrum-gray-600);
    }
  `;

  @property({ type: Array })
  events: StrumTabletEvent[] = [];

  @property({ type: Boolean })
  isEmpty = false;

  @property({ type: Object })
  deviceInfo?: EventsDeviceInfo;

  @property({ type: Object })
  lastStrumEvent: StrumEventData | null = null;

  private _formatValue(value: number | undefined, decimals: number = 3): string {
    if (value === undefined) return '—';
    return value.toFixed(decimals);
  }

  private _getPressedTabletButton(event: TabletEvent): number | null {
    if (event.button1) return 1;
    if (event.button2) return 2;
    if (event.button3) return 3;
    if (event.button4) return 4;
    if (event.button5) return 5;
    if (event.button6) return 6;
    if (event.button7) return 7;
    if (event.button8) return 8;
    return null;
  }

  private _renderStrumSection() {
    const latestEvent = this.events.length > 0 ? this.events[this.events.length - 1] : null;
    const strumData = latestEvent?.strum || this.lastStrumEvent;

    return html`
      <div class="strum-section">
        <div class="strum-header">
          <span class="strum-label">Strum</span>
          ${strumData ? html`
            <span class="strum-type ${strumData.type}">${strumData.type}</span>
          ` : ''}
        </div>
        
        ${strumData && strumData.type === 'strum' && strumData.notes.length > 0 ? html`
          <div class="strum-notes">
            ${strumData.notes.map(n => html`
              <div class="note-chip">
                <span class="note-name">${n.note.notation}${n.note.octave}</span>
                <span class="note-velocity">v${n.velocity}</span>
              </div>
            `)}
          </div>
          <div class="strum-velocity">Velocity: ${strumData.velocity}</div>
        ` : strumData && strumData.type === 'release' ? html`
          <div class="no-strum">Released</div>
        ` : html`
          <div class="no-strum">No strum</div>
        `}
      </div>
    `;
  }

  render() {
    if (this.isEmpty || this.events.length === 0) {
      return html`
        <div class="events-container empty">
          <div class="empty-state">
            <div class="empty-icon">—</div>
            <p>No events yet</p>
          </div>
        </div>
      `;
    }

    // Get the latest event
    const event = this.events[this.events.length - 1];

    return html`
      <div class="events-container">
        <div class="event-header">
          <span class="event-count">${this.deviceInfo?.packetCount ?? this.events.length}</span>
          <span class="event-label">events</span>
          <div class="header-badges">
            ${this.deviceInfo?.isMock ? html`<span class="source-badge mock">mock</span>` : ''}
            ${this.deviceInfo?.isTranslated ? html`<span class="source-badge translated">translated</span>` : ''}
          </div>
        </div>
        
        <div class="event-grid">
          <div class="event-field">
            <span class="field-label">X</span>
            <span class="field-value">${this._formatValue(event.x)}</span>
          </div>
          <div class="event-field">
            <span class="field-label">Y</span>
            <span class="field-value">${this._formatValue(event.y)}</span>
          </div>
          <div class="event-field">
            <span class="field-label">Pressure</span>
            <span class="field-value">${this._formatValue(event.pressure)}</span>
          </div>
          <div class="event-field">
            <span class="field-label">Tilt X</span>
            <span class="field-value">${this._formatValue(event.tiltX)}</span>
          </div>
          <div class="event-field">
            <span class="field-label">Tilt Y</span>
            <span class="field-value">${this._formatValue(event.tiltY)}</span>
          </div>
        </div>

        <div class="button-status">
          <div class="button-indicator ${event.primaryButtonPressed ? 'active' : ''}">
            <span class="button-label">Primary</span>
          </div>
          <div class="button-indicator ${event.secondaryButtonPressed ? 'active' : ''}">
            <span class="button-label">Secondary</span>
          </div>
          <div class="button-indicator tablet-btn ${this._getPressedTabletButton(event) ? 'active' : ''}">
            <span class="button-label">Tablet ${this._getPressedTabletButton(event) ?? '—'}</span>
          </div>
        </div>

        ${this._renderStrumSection()}
      </div>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'strum-events-display': StrumEventsDisplay;
  }
}
