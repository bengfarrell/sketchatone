import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { styles } from './sketchatone-tablet-app.styles.js';

// Spectrum theme wrapper and theme definitions
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';

// Import sketchatone dashboard component
import '../sketchatone-dashboard/sketchatone-dashboard.js';

type ThemeColor = 'light' | 'dark';

/**
 * Sketchatone Tablet App (WebSocket Mode)
 *
 * WebSocket-only tablet viewer. Receives pre-processed tablet events
 * via WebSocket from a server running blankslate's tablet-websocket CLI.
 *
 * No WebHID support, no config loading needed - all data comes from the socket.
 */
@customElement('sketchatone-tablet-app')
export class SketchatoneTabletApp extends LitElement {
  static styles = styles;

  @state()
  private themeColor: ThemeColor = 'light';

  constructor() {
    super();
    // Check for saved preference or system preference
    const saved = localStorage.getItem('sketchatone-theme') as ThemeColor | null;
    if (saved) {
      this.themeColor = saved;
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
      this.themeColor = 'dark';
    }
    this._updateDocumentBackground();
  }

  private _updateDocumentBackground() {
    // Update document background to match theme for overscroll areas
    const bgColor = this.themeColor === 'dark' ? '#1a1a1a' : '#f5f7fa';
    document.documentElement.style.backgroundColor = bgColor;
    document.body.style.backgroundColor = bgColor;
    // Update theme class for scrollbar styling
    document.documentElement.classList.remove('light-theme', 'dark-theme');
    document.documentElement.classList.add(`${this.themeColor}-theme`);
  }

  private _toggleTheme() {
    this.themeColor = this.themeColor === 'light' ? 'dark' : 'light';
    localStorage.setItem('sketchatone-theme', this.themeColor);
    this._updateDocumentBackground();
  }

  render() {
    return html`
      <sp-theme system="spectrum" color=${this.themeColor} scale="medium">
        <div class="app">
          <div class="page-content">
            <sketchatone-dashboard
              app-title="Sketchatone Dashboard"
              .themeColor=${this.themeColor}
              @theme-toggle=${this._toggleTheme}>
            </sketchatone-dashboard>
          </div>
        </div>
      </sp-theme>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketchatone-tablet-app': SketchatoneTabletApp;
  }
}
