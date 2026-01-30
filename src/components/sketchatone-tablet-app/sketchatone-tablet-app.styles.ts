import { css } from 'lit';

export const styles = css`
  :host {
    display: block;
  }

  .app {
    min-height: 100vh;
    display: flex;
    flex-direction: column;
    background: var(--spectrum-gray-100);
  }

  .nav-bar {
    padding: 16px 24px;
    background: var(--spectrum-gray-50);
    backdrop-filter: blur(10px);
    border-bottom: 1px solid var(--spectrum-gray-300);
    position: sticky;
    top: 0;
    z-index: 100;
  }

  .back-button {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 10px 20px;
    background: var(--spectrum-gray-50);
    border: 2px solid var(--spectrum-accent-color-900);
    border-radius: 8px;
    color: var(--spectrum-accent-color-900);
    font-size: 0.95rem;
    font-weight: 600;
    cursor: pointer;
    transition: all 0.2s ease;
  }

  .back-button:hover {
    background: var(--spectrum-accent-color-900);
    color: var(--spectrum-gray-50);
  }

  .back-arrow {
    font-size: 1.2rem;
    transition: transform 0.2s ease;
  }

  .back-button:hover .back-arrow {
    transform: translateX(-3px);
  }

  .page-content {
    flex: 1;
  }

  /* Walkthrough page styling */
  .page-content hid-data-reader {
    max-width: 1000px;
    margin: 0 auto;
    padding: 30px;
  }

  /* Dashboard page styling */
  .page-content hid-dashboard {
    max-width: 1400px;
    margin: 0 auto;
    padding: 30px;
  }
`;
