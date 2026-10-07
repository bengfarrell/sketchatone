import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import '../../design-system/components/sketch-button.js';
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
      padding: var(--sketch-spacing-4);
      max-width: 1200px;
      margin: 0 auto;
    }

    h1 {
      color: var(--sketch-color-gray-900);
      margin-bottom: var(--sketch-spacing-3);
    }

    .content {
      background: var(--sketch-color-gray-50);
      border-radius: var(--sketch-spacing-2);
      padding: var(--sketch-spacing-3);
    }
  `;

  @state()
  private message = 'Welcome to Sketchatone';

  render() {
    return html`
      <div class="sketch-theme">
        <div class="container">
          <h1>${this.message}</h1>
          <div class="content">
            <p>Application is ready.</p>
            <sketch-button variant="primary" @click=${this._handleClick}>
              Get Started
            </sketch-button>
          </div>
        </div>
      </div>
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
