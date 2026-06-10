import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
    width: 100%;
    max-width: 100%;
    overflow-x: hidden;
  }

  /* Slotted form title (back button + title) for Actions/Groups panels */
  .panel-form-title {
    display: flex;
    align-items: center;
    gap: 6px;
    min-width: 0;
  }

  .panel-form-title .panel-title {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    color: var(--sketch-color-gray-900);
    letter-spacing: 0.3px;
    text-transform: uppercase;
    opacity: 0.9;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .dashboard {
    display: flex;
    flex-direction: column;
    gap: 16px;
    padding: 16px;
    background: var(--sketch-color-gray-50);
    max-width: 100%;
    box-sizing: border-box;
  }

  @media (max-width: 640px) {
    .dashboard {
      padding: 8px;
      gap: 12px;
    }
  }

  /* Header */
  .dashboard-header {
    display: flex;
    flex-direction: row;
    gap: 16px;
    padding: 12px 16px;
    background: var(--sketch-color-gray-100);
    border-radius: 8px;
    align-items: center;
  }

  @media (max-width: 640px) {
    .dashboard-header {
      flex-direction: column;
      align-items: stretch;
      gap: 12px;
      padding: 12px;
    }
  }

  .header-logo-container {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  @media (max-width: 640px) {
    .header-logo-container {
      justify-content: center;
    }
  }

  .header-logo {
    height: 130px;
  }

  @media (max-width: 640px) {
    .header-logo {
      height: 80px;
    }
  }

  /* Theme-adaptive logo colors */
  .logo-bg {
    fill: var(--sketch-color-gray-200);
  }

  .logo-title {
    fill: var(--sketch-color-gray-800);
  }

  .logo-subtitle {
    fill: var(--sketch-color-gray-600);
  }

  .logo-line {
    stroke: var(--sketch-color-gray-500);
  }

  .header-content {
    display: flex;
    flex-direction: column;
    gap: 8px;
    flex: 1;
    min-width: 0;
  }

  .header-row {
    display: flex;
    justify-content: flex-end;
    align-items: center;
  }

  @media (max-width: 640px) {
    .header-row {
      justify-content: center;
    }
  }

  .header-controls {
    display: flex;
    gap: 8px;
    align-items: center;
    flex-wrap: wrap;
  }

  @media (max-width: 640px) {
    .header-controls {
      justify-content: center;
    }
  }

  /* Connection UI */
  .connection-row {
    display: flex;
    align-items: center;
    justify-content: flex-end;
    gap: 16px;
    flex-wrap: wrap;
  }

  @media (max-width: 640px) {
    .connection-row {
      justify-content: center;
      gap: 8px;
    }
  }

  .connection-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .save-button-group {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  /* Config Header */
  .config-header {
    display: flex;
    align-items: center;
    margin-top: 12px;
  }

  .config-filename {
    font-size: 1.1rem;
    font-weight: 600;
    color: var(--sketch-color-gray-900);
  }

  .config-separator {
    border-top: 1px solid var(--sketch-color-gray-200);
    margin-top: 8px;
  }

  /* Config Management Row */
  .config-row {
    display: flex;
    align-items: center;
    gap: 16px;
    padding-top: 8px;
  }

  .config-management-group {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }

  .config-management-group select.sketch-select {
    min-width: 150px;
  }

  .status-badge {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px;
    border-radius: 16px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .status-badge.connected {
    background: var(--sketch-color-green-100);
    color: var(--sketch-color-green-900);
  }

  .status-badge.disconnected {
    background: var(--sketch-color-gray-200);
    color: var(--sketch-color-gray-700);
  }

  .status-badge.disconnected .status-dot {
    background: var(--sketch-color-gray-500);
  }

  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: var(--sketch-color-green-600);
  }

  /* Version Info */
  .version-info {
    display: flex;
    gap: 16px;
    justify-content: flex-end;
    font-size: 0.7rem;
    color: var(--sketch-color-gray-500);
    margin-top: 4px;
  }

  .version-label {
    font-family: monospace;
  }

  /* Disconnected Message */
  .disconnected-message {
    display: flex;
    justify-content: center;
    align-items: center;
    padding: 48px 24px;
    color: var(--sketch-color-gray-600);
    font-size: 1rem;
  }

  .disconnected-message p {
    margin: 0;
  }

  /* Panels Grid - main layout for all panels */
  .panels-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
    margin-top: 16px;
    max-width: 100%;
    overflow: hidden;
  }

  @media (max-width: 1024px) {
    .panels-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .panels-grid {
      grid-template-columns: 1fr;
      gap: 12px;
      margin-top: 12px;
    }
  }

  /* MIDI Panel Content */
  .midi-panel-content {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .midi-status-row {
    display: flex;
    justify-content: flex-start;
  }

  /* Strum Main Visualizer */
  .strum-main-visualizer {
    margin-bottom: 16px;
  }

  .strum-visualizer-wrapper {
    display: flex;
    justify-content: center;
    padding: 16px;
  }

  .strum-visualizer-wrapper tablet-visualizer {
    max-width: 600px;
    width: 100%;
  }

  /* Piano styling */
  piano-keys {
    width: 100%;
    max-width: 100%;
  }

  /* Settings Grid - matches visualizers-grid sizing */
  .settings-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  @media (max-width: 1024px) {
    .settings-grid {
      grid-template-columns: repeat(2, 1fr);
    }
  }

  @media (max-width: 640px) {
    .settings-grid {
      grid-template-columns: 1fr;
    }
  }

  /* Settings Form */
  .settings-form {
    display: flex;
    flex-direction: column;
    gap: 12px;
    padding: 8px 0;
  }

  .setting-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .setting-row label {
    font-size: 0.875rem;
    color: var(--sketch-color-gray-700);
    flex-shrink: 0;
  }

  .setting-row input.sketch-input {
    width: 100px;
  }

  .setting-row select.sketch-select {
    flex: 1;
    min-width: 150px;
  }

  .setting-row input.sketch-checkbox {
    margin: 0;
  }

  /* Chord Progression */
  .chord-progression {
    display: flex;
    flex-direction: column;
    gap: 16px;
  }

  .preset-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }

  .preset-row select.sketch-select {
    flex: 1;
  }

  .chord-buttons {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 8px;
  }

  .chord-button {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 12px 8px;
    background: var(--sketch-color-gray-100);
    border: 2px solid var(--sketch-color-gray-300);
    border-radius: 8px;
    transition: all 0.15s ease;
  }

  .chord-button.active {
    background: var(--sketch-color-green-100);
    border-color: var(--sketch-color-green-600);
  }

  .chord-button .button-number {
    font-size: 0.7rem;
    color: var(--sketch-color-gray-600);
    margin-bottom: 4px;
  }

  .chord-button .chord-name {
    font-size: 1rem;
    font-weight: 600;
    color: var(--sketch-color-gray-900);
  }

  .chord-button.active .chord-name {
    color: var(--sketch-color-green-800);
  }

  /* Placeholder */
  .placeholder-visualizer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 48px;
    background: var(--sketch-color-gray-75);
    border-radius: 8px;
    border: 2px dashed var(--sketch-color-gray-300);
  }

  .placeholder-visualizer p {
    margin: 0;
    font-size: 1.25rem;
    color: var(--sketch-color-gray-700);
  }

  .placeholder-hint {
    font-size: 0.875rem !important;
    color: var(--sketch-color-gray-500) !important;
    margin-top: 8px !important;
  }

  /* Visualizers Grid */
  .visualizers-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 16px;
  }

  .visualizer-card {
    background: var(--sketch-color-gray-100);
    border-radius: 12px;
    border: 1px solid var(--sketch-color-gray-200);
    padding: 16px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
    transition: all 0.2s ease;
  }

  .visualizer-card:hover {
    border-color: var(--sketch-color-gray-300);
    box-shadow: 0 6px 12px rgba(0, 0, 0, 0.15);
  }

  .visualizer-card.compact {
    padding: 12px;
  }

  .visualizer-wrapper {
    aspect-ratio: 1;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  /* Performance panel: full-width mappings list above a string strip */
  .performance-layout {
    display: flex;
    flex-direction: column;
    gap: 8px;
    align-items: stretch;
    min-height: 0;
    height: 100%;
  }

  .active-mappings {
    flex: 1 1 auto;
    min-height: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    overflow-y: auto;
    padding: 4px 0;
  }

  .performance-strip {
    flex: 0 0 auto;
    width: 100%;
  }

  .ps-container {
    position: relative;
    width: 100%;
    height: 80px;
  }

  .ps-container::before {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    top: 46px;
    height: 1px;
    background: var(--svg-gray-700, #6b7280);
    opacity: 0.35;
  }

  .ps-string {
    position: absolute;
    top: 8px;
    bottom: 30px;
    width: 1.5px;
    background: var(--svg-gray-700, #6b7280);
    opacity: 0.55;
    transform: translateX(-50%);
  }

  .ps-string.plucked {
    width: 3px;
    background: #4ade80;
    opacity: 1;
  }

  .ps-label {
    position: absolute;
    bottom: 4px;
    transform: translateX(-50%);
    font-size: 14px;
    line-height: 1;
    color: var(--svg-gray-500, #9ca3af);
    font-weight: 500;
    white-space: nowrap;
    pointer-events: none;
  }

  .ps-label.plucked {
    color: #4ade80;
    font-weight: 700;
  }

  .ps-indicator {
    position: absolute;
    top: 21px;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    transform: translate(-50%, -50%);
    pointer-events: none;
    background: #74c0fc;
  }

  .ps-indicator.contact {
    width: 20px;
    height: 20px;
    background: #ff6b6b;
  }

  .performance-strip-empty {
    color: var(--sketch-color-gray-500);
    font-style: italic;
    font-size: 0.85em;
    text-align: center;
    padding: 8px 0;
  }

  .active-mappings-empty {
    color: var(--sketch-color-gray-500);
    font-style: italic;
    font-size: 0.85em;
    padding: 8px 0;
  }

  .stylus-row {
    display: flex;
    gap: 6px;
    margin-bottom: 6px;
  }

  .stylus-row .mapping-chip {
    flex: 1 1 0;
    min-width: 0;
  }

  .buttons-grid {
    column-count: 2;
    column-gap: 6px;
  }

  .buttons-grid .mapping-chip {
    margin-bottom: 4px;
    break-inside: avoid;
  }

  .mapping-chip {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 3px 6px;
    background: var(--sketch-color-gray-100);
    border-radius: 4px;
    font-size: 0.85em;
    min-width: 0;
    transition: background-color 80ms ease-out;
  }

  .mapping-chip.active {
    background: var(--sketch-color-blue-200, #c7e2ff);
    box-shadow: inset 0 0 0 1px var(--sketch-color-blue-500, #2680eb);
  }

  .mc-badge {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 auto;
    min-width: 22px;
    height: 22px;
    padding: 0 6px;
    border-radius: 11px;
    background: var(--sketch-color-gray-300);
    color: var(--sketch-color-gray-900);
    font-weight: 700;
    font-size: 0.85em;
    line-height: 1;
  }

  .mc-badge.stylus.primary {
    background: var(--sketch-color-indigo-200, #d8d4ff);
    color: var(--sketch-color-indigo-900, #2c1e7a);
  }

  .mc-badge.stylus.secondary {
    background: var(--sketch-color-magenta-200, #ffd7ec);
    color: var(--sketch-color-magenta-900, #6b1147);
  }

  .mapping-chip.active .mc-badge {
    background: var(--sketch-color-blue-500, #2680eb);
    color: #fff;
  }

  .mc-action {
    color: var(--sketch-color-gray-800);
    font-family: monospace;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1 1 auto;
    min-width: 0;
  }

  .events-panel {
    grid-row: span 1;
  }

  .bytes-panel {
    grid-column: span 3;
  }

  /* Data Values */
  .data-values {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }

  .data-values.compact {
    gap: 4px;
  }

  .data-item {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 2px 8px;
    background: var(--sketch-color-gray-100);
    border-radius: 4px;
    font-size: 0.75rem;
  }

  .data-label {
    color: var(--sketch-color-gray-600);
    font-weight: 500;
  }

  .data-value {
    color: var(--sketch-color-gray-900);
    font-family: monospace;
  }

  .data-value.zero {
    color: var(--sketch-color-gray-400);
  }

  /* Responsive */
  @media (max-width: 1024px) {
    .visualizers-grid {
      grid-template-columns: repeat(2, 1fr);
    }

    .bytes-panel {
      grid-column: span 2;
    }
  }

  @media (max-width: 640px) {
    .visualizers-grid {
      grid-template-columns: 1fr;
    }

    .bytes-panel {
      grid-column: span 1;
    }

  }

  /* MIDI Input Panel (inside visualizers-grid) */
  .visualizer-card.midi-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px;
  }

  .midi-panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .midi-panel-title {
    font-size: 1rem;
    font-weight: 600;
    color: var(--sketch-color-gray-900);
  }

  .status-badge.small {
    font-size: 0.8rem;
    padding: 3px 8px;
  }

  .midi-notes {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 12px;
    background: var(--sketch-color-blue-100);
    border-radius: 6px;
    font-size: 0.875rem;
  }

  .midi-notes.compact {
    padding: 6px 10px;
    font-size: 0.875rem;
  }

  .midi-notes-label {
    color: var(--sketch-color-blue-900);
    font-weight: 500;
  }

  .midi-notes-value {
    color: var(--sketch-color-blue-900);
    font-family: monospace;
    font-weight: 600;
  }

  .midi-source {
    font-size: 0.8rem;
    color: var(--sketch-color-gray-700);
    font-style: italic;
  }

  .midi-ports-list {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .midi-ports-label {
    font-size: 0.875rem;
    color: var(--sketch-color-gray-800);
  }

  .midi-ports {
    list-style: none;
    margin: 6px 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
    max-height: 150px;
    overflow-y: auto;
  }

  .midi-port-item {
    padding: 6px 10px;
    background: var(--sketch-color-gray-200);
    border-radius: 4px;
    font-family: monospace;
    font-size: 0.875rem;
    color: var(--sketch-color-gray-900);
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .midi-port-item:hover {
    background: var(--sketch-color-gray-300);
  }

  .midi-port-item.selected {
    background: var(--sketch-color-blue-200);
    border-left: 3px solid var(--sketch-color-blue-700);
    color: var(--sketch-color-blue-900);
    font-weight: 600;
  }

  .midi-port-item.active {
    background: var(--sketch-color-green-200);
    border-left: 3px solid var(--sketch-color-green-700);
    color: var(--sketch-color-green-900);
  }

  .midi-port-item.selected.active {
    background: var(--sketch-color-green-200);
    border-left: 3px solid var(--sketch-color-blue-700);
  }

  /* Compact mode (e.g. 800x480 Raspberry Pi display) */
  .dashboard.compact {
    gap: 8px;
    padding: 8px;
    height: 100vh;
    overflow: hidden;
    box-sizing: border-box;
  }

  .compact-nav-row {
    position: relative;
    display: flex;
    gap: 4px;
    align-items: stretch;
  }

  .compact-nav {
    display: flex;
    gap: 4px;
    padding: 4px 4px 12px;
    background: var(--sketch-color-gray-100);
    border-radius: 8px;
    border: 1px solid var(--sketch-color-gray-200);
    overflow-x: auto;
    overflow-y: hidden;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
    flex: 1 1 auto;
    min-width: 0;
  }

  .compact-settings-btn {
    flex: 0 0 auto;
    width: 36px;
    padding: 0;
    border-radius: 8px;
    border: 1px solid var(--sketch-color-gray-200);
    background: var(--sketch-color-gray-100);
    color: var(--sketch-color-gray-800);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
    user-select: none;
  }

  .compact-settings-btn.active,
  .compact-settings-btn:hover {
    background: var(--sketch-color-gray-200);
  }

  .compact-settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 20;
    background: transparent;
  }

  .compact-settings-popover {
    position: absolute;
    top: calc(100% + 4px);
    right: 0;
    z-index: 21;
    min-width: 200px;
    max-height: calc(100vh - 80px);
    overflow-y: auto;
    padding: 6px;
    background: var(--sketch-color-gray-75);
    border: 1px solid var(--sketch-color-gray-300);
    border-radius: 8px;
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.2);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .compact-settings-header {
    padding: 4px 8px;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--sketch-color-gray-700);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .compact-settings-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 4px;
    font-size: 0.85rem;
    color: var(--sketch-color-gray-900);
    cursor: pointer;
    user-select: none;
  }

  .compact-settings-item:hover {
    background: var(--sketch-color-gray-100);
  }

  .compact-settings-item input {
    margin: 0;
    cursor: pointer;
  }

  .compact-nav-item {
    flex: 0 0 auto;
    padding: 9px 15px;
    border-radius: 6px;
    border: 1px solid var(--sketch-color-gray-300);
    background: var(--sketch-color-gray-75);
    color: var(--sketch-color-gray-700);
    font-size: 1.2rem;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
    user-select: none;
  }

  .compact-nav-item.active {
    background: var(--sketch-color-blue-700);
    border-color: var(--sketch-color-blue-700);
    color: var(--sketch-color-gray-50);
  }

  .panels-grid.compact {
    display: flex;
    flex-direction: row;
    align-items: stretch;
    gap: 8px;
    grid-template-columns: none;
    margin-top: 0;
    flex: 1;
    min-height: 0;
  }

  .panels-grid.compact > dashboard-panel {
    display: block;
    flex: 1 1 0;
    min-width: 0;
    min-height: 0;
    order: 2;
    font-size: 1.5em;
  }

  /* Constrain visualizer wrappers so the square aspect ratio cannot push the
     panel taller than the viewport on 480px-class displays. Drive sizing
     primarily by height (the tight axis on 480px screens); aspect-ratio fills
     the width to match. The subtracted value approximates surrounding chrome
     (compact nav + panel header + content padding + data-values row). */
  .dashboard.compact .visualizer-wrapper {
    aspect-ratio: 1;
    width: auto;
    height: auto;
    max-width: 100%;
    max-height: calc(100vh - 220px);
    margin: 0 auto;
  }

  /* Curve visualizers (Velocity / Duration / Pitch) lay out side-by-side in
     compact mode (SVG left, controls right). Give the host a defined height
     so the SVG's max-height:100% has something to resolve against, and the
     curve panel fills the available panel-content area. */
  .dashboard.compact curve-visualizer {
    height: 100%;
    width: 100%;
  }

  /* Settings forms (Strumming Settings, Strum Release) lay out as 2 columns
     in compact mode to use horizontal space instead of scrolling vertically. */
  .dashboard.compact .settings-form {
    display: grid;
    grid-template-columns: 1fr 1fr;
    column-gap: 16px;
    row-gap: 23px;
  }

  .dashboard.compact .settings-form .setting-row label {
    flex: 0 0 50%;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .dashboard.compact .settings-form .setting-row select.sketch-select,
  .dashboard.compact .settings-form .setting-row input.sketch-input {
    min-width: 0;
    width: auto;
    flex: 1;
  }



  .compact-caret {
    flex: 0 0 auto;
    align-self: stretch;
    width: 36px;
    border: 1px solid var(--sketch-color-gray-300);
    border-radius: 6px;
    background: var(--sketch-color-gray-100);
    color: var(--sketch-color-gray-800);
    font-size: 2rem;
    line-height: 1;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    user-select: none;
    opacity: 0.85;
  }

  .compact-caret:hover:not(:disabled) {
    background: var(--sketch-color-gray-200);
    opacity: 1;
  }

  .compact-caret:disabled {
    opacity: 0.3;
    cursor: default;
  }

  .compact-caret.prev {
    order: 1;
  }

  .compact-caret.next {
    order: 3;
  }

`;
