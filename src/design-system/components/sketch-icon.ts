/**
 * Sketchatone icon component.
 * Renders a 16-unit-viewbox SVG by name. Size and color follow font size and currentColor.
 */
import { LitElement, html, svg, css, nothing } from 'lit';
import { customElement, property } from 'lit/decorators.js';

type IconName =
  | 'add' | 'arrow-left' | 'close' | 'crosshairs' | 'delete' | 'download'
  | 'edit' | 'folder-open' | 'light' | 'link' | 'link-off' | 'moon';

const ICONS: Record<IconName, ReturnType<typeof svg>> = {
  add: svg`<path d="M14 7H9V2a1 1 0 0 0-2 0v5H2a1 1 0 0 0 0 2h5v5a1 1 0 0 0 2 0V9h5a1 1 0 0 0 0-2z"/>`,
  'arrow-left': svg`<path d="M14 7H4.41l3.3-3.29a1 1 0 1 0-1.42-1.42l-5 5a1 1 0 0 0 0 1.42l5 5a1 1 0 0 0 1.42-1.42L4.41 9H14a1 1 0 0 0 0-2z"/>`,
  close: svg`<path d="M9.41 8l4.3-4.29a1 1 0 1 0-1.42-1.42L8 6.59l-4.29-4.3a1 1 0 0 0-1.42 1.42L6.59 8l-4.3 4.29a1 1 0 1 0 1.42 1.42L8 9.41l4.29 4.3a1 1 0 0 0 1.42-1.42z"/>`,
  crosshairs: svg`<path d="M15 7h-2.05a5 5 0 0 0-3.95-3.95V1a1 1 0 0 0-2 0v2.05A5 5 0 0 0 3.05 7H1a1 1 0 0 0 0 2h2.05A5 5 0 0 0 7 12.95V15a1 1 0 0 0 2 0v-2.05A5 5 0 0 0 12.95 9H15a1 1 0 0 0 0-2zM8 11a3 3 0 1 1 3-3 3 3 0 0 1-3 3z"/><circle cx="8" cy="8" r="1.5"/>`,
  delete: svg`<path d="M14 3h-3V2a1 1 0 0 0-1-1H6a1 1 0 0 0-1 1v1H2a1 1 0 0 0 0 2h1v9a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5h1a1 1 0 0 0 0-2zM7 3V2.5h2V3zm5 10H4V5h8z"/><path d="M6 7v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-1 0zM9 7v4a.5.5 0 0 0 1 0V7a.5.5 0 0 0-1 0z"/>`,
  download: svg`<path d="M14 10a1 1 0 0 0-1 1v2H3v-2a1 1 0 0 0-2 0v3a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3a1 1 0 0 0-1-1z"/><path d="M7.3 11.7a1 1 0 0 0 1.4 0l3.5-3.5a1 1 0 0 0-1.4-1.4L9 8.59V2a1 1 0 0 0-2 0v6.59L5.2 6.8a1 1 0 0 0-1.4 1.4z"/>`,
  edit: svg`<path d="M13.7 3.3l-1-1a1 1 0 0 0-1.4 0L2.3 11.3a1 1 0 0 0-.27.48l-1 4a1 1 0 0 0 1.21 1.21l4-1a1 1 0 0 0 .48-.27L15.7 6.7a1 1 0 0 0 0-1.4zM5.78 14.07L3.3 14.7l.63-2.48L11 5.41 12.59 7zM13.3 6.3L11.7 4.7l1.3-1.3 1.6 1.6z"/>`,
  'folder-open': svg`<path d="M15 5H8.41L7 3.59A2 2 0 0 0 5.59 3H2a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h11.5a1 1 0 0 0 .95-.68l1.5-5A1 1 0 0 0 15 5zM3 5h2.59L7 6.41A2 2 0 0 0 8.41 7H13l-1 4H3z"/>`,
  light: svg`<path d="M8 4a4 4 0 1 0 4 4 4 4 0 0 0-4-4zm0 6a2 2 0 1 1 2-2 2 2 0 0 1-2 2zM8 2a1 1 0 0 0 1-1V0a1 1 0 0 0-2 0v1a1 1 0 0 0 1 1zM8 14a1 1 0 0 0-1 1v1a1 1 0 0 0 2 0v-1a1 1 0 0 0-1-1zM3.05 4.46L2.34 3.76a1 1 0 0 0-1.41 1.41l.7.71a1 1 0 0 0 1.42-1.42zM12.95 11.54l.71.7a1 1 0 0 0 1.41-1.41l-.7-.71a1 1 0 0 0-1.42 1.42zM2 8a1 1 0 0 0-1-1H0a1 1 0 0 0 0 2h1a1 1 0 0 0 1-1zM16 7h-1a1 1 0 0 0 0 2h1a1 1 0 0 0 0-2zM3.05 11.54a1 1 0 0 0-1.42 0l-.7.71a1 1 0 0 0 1.41 1.41l.71-.7a1 1 0 0 0 0-1.42zM12.95 4.46a1 1 0 0 0 .71-.29l.7-.71a1 1 0 0 0-1.41-1.41l-.71.7a1 1 0 0 0 .71 1.71z"/>`,
  link: svg`<path d="M7.59 8.7a3 3 0 0 1 0-4.24L9.7 2.34a3 3 0 1 1 4.24 4.24l-1.06 1.06a1 1 0 0 1-1.42-1.41L12.52 5.17a1 1 0 0 0-1.41-1.42L9 5.88a1 1 0 0 0 0 1.41 1 1 0 0 1-1.41 1.41zM8.41 7.3a3 3 0 0 1 0 4.24L6.3 13.66a3 3 0 1 1-4.24-4.24l1.06-1.06a1 1 0 0 1 1.42 1.41L3.48 10.83a1 1 0 0 0 1.41 1.42L7 10.12a1 1 0 0 0 0-1.41 1 1 0 0 1 1.41-1.41z"/>`,
  'link-off': svg`<path d="M14.78 13.36L2.64 1.22a1 1 0 0 0-1.42 1.42l3.21 3.21-2.13 2.13a3 3 0 0 0 4.24 4.24l1.06-1.06 4.55 4.55a1 1 0 0 0 1.42-1.42zM7.13 10.71l-1.06 1.06a1 1 0 1 1-1.42-1.42l2.13-2.12 1.41 1.41zM9.71 5.88L11.11 4.46a1 1 0 0 1 1.41 1.42l-1.06 1.06 1.41 1.42 1.06-1.06a3 3 0 0 0-4.24-4.24L8.29 4.46z"/>`,
  moon: svg`<path d="M9 16a8 8 0 0 1-6.18-13.06A1 1 0 0 1 4.5 3.47a6 6 0 0 0 8.03 8.03 1 1 0 0 1 1.5 1.18A8 8 0 0 1 9 16z"/>`,
};

@customElement('sketch-icon')
export class SketchIcon extends LitElement {
  static styles = css`
    :host {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 1em;
      height: 1em;
      line-height: 0;
      flex: 0 0 auto;
    }
    svg {
      width: 100%;
      height: 100%;
      fill: currentColor;
      display: block;
    }
  `;

  @property({ type: String })
  name: IconName | '' = '';

  render() {
    if (!this.name || !ICONS[this.name as IconName]) return nothing;
    return html`
      <svg viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" focusable="false">
        ${ICONS[this.name as IconName]}
      </svg>
    `;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'sketch-icon': SketchIcon;
  }
}
