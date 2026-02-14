import { LitElement, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { styles } from './sketchatone-web-app.styles.js';

// Spectrum theme wrapper and theme definitions
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/button/sp-button.js';

// Import blankslate components
import 'blankslate/components/hid-dashboard/hid-dashboard.js';
import 'blankslate/components/hid-data-reader/hid-data-reader.js';

import type { Config } from 'blankslate/models';

type AppPage = 'dashboard' | 'walkthrough';
type ThemeColor = 'light' | 'dark';

/**
 * Sketchatone Web App (WebHID Mode)
 * 
 * Browser-based tablet viewer using WebHID API.
 * Requires loading a config file and connecting to the tablet directly.
 * No WebSocket support - all data comes from the browser's WebHID connection.
 */
@customElement('sketchatone-web-app')
export class SketchatoneWebApp extends LitElement {
  static styles = styles;

  @state()
  private currentPage: AppPage = 'dashboard';

  @state()
  private loadedConfig: Config | null = null;

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

  private _handleGoToGenerator() {
    this.currentPage = 'walkthrough';
  }

  private _handleBackToDashboard() {
    this.currentPage = 'dashboard';
  }

  private _handleConfigLoadedFromDashboard(e: CustomEvent) {
    this.loadedConfig = e.detail.config;
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
          ${this.currentPage === 'walkthrough' ? html`
            <div class="nav-bar">
              <sp-button data-spectrum-pattern="button-secondary" variant="secondary" @click=${this._handleBackToDashboard}>
                ← Back to Dashboard
              </sp-button>
            </div>
          ` : ''}

          <div class="page-content">
            ${this.currentPage === 'walkthrough' ? html`
              <hid-data-reader></hid-data-reader>
            ` : ''}

            ${this.currentPage === 'dashboard' ? html`
              <hid-dashboard
                mode="webhid"
                app-title="Sketchatone Web"
                .config=${this.loadedConfig}
                .themeColor=${this.themeColor}
                @config-loaded=${this._handleConfigLoadedFromDashboard}
                @go-to-generator=${this._handleGoToGenerator}
                @theme-toggle=${this._toggleTheme}>
              </hid-dashboard>
            ` : ''}
          </div>
        </div>
      </sp-theme>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketchatone-web-app': SketchatoneWebApp;
  }
}
