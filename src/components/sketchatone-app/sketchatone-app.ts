import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '@spectrum-web-components/theme/sp-theme.js';
import '@spectrum-web-components/theme/src/themes.js';
import '@spectrum-web-components/button/sp-button.js';

/**
 * Main application component for Sketchatone
 */
@customElement('sketchatone-app')
export class SketchatoneApp extends LitElement {
  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
    }

    .container {
      padding: var(--spectrum-global-dimension-size-400);
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      color: var(--spectrum-global-color-gray-900);
      margin-bottom: var(--spectrum-global-dimension-size-300);
    }

    .content {
      background: var(--spectrum-global-color-gray-50);
      border-radius: var(--spectrum-global-dimension-size-100);
      padding: var(--spectrum-global-dimension-size-300);
    }
  `;

  @state()
  private message = 'Welcome to Sketchatone';

  render() {
    return html`
      <sp-theme theme="spectrum" color="light" scale="medium">
        <div class="container">
          <h1>${this.message}</h1>
          <div class="content">
            <p>Application is ready.</p>
            <sp-button variant="primary" @click=${this._handleClick}>
              Get Started
            </sp-button>
          </div>
        </div>
      </sp-theme>
    `;
  }

  private _handleClick() {
    this.message = 'Let\'s go!';
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketchatone-app': SketchatoneApp;
  }
}
