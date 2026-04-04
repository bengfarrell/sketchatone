/**
 * Keyboard Listener for Server-Side Input
 *
 * System-level keyboard listener that works with systemd services.
 * Uses node-global-key-listener for global keyboard capture on Linux/macOS/Windows.
 * Requires root/sudo permissions or accessibility permissions on macOS.
 */

import type { ButtonId } from '../models/action-rules.js';

export interface KeyboardListenerOptions {
  enabled: boolean;
  mappings: Record<string, string>;
  onButtonPress: (buttonId: ButtonId) => void;
  onButtonRelease: (buttonId: ButtonId) => void;
}

/**
 * System-level keyboard listener that maps keys to button events.
 *
 * - On Linux: Requires root or input group membership
 * - On macOS: Requires accessibility permissions or root
 * - On Windows: Should work without special permissions
 *
 * Works with systemd services and background processes.
 */
export class KeyboardListener {
  private enabled: boolean;
  private mappings: Record<string, string>;
  private onButtonPress: (buttonId: ButtonId) => void;
  private onButtonRelease: (buttonId: ButtonId) => void;
  private listener: any = null;

  constructor(options: KeyboardListenerOptions) {
    this.enabled = options.enabled;
    this.mappings = options.mappings;
    this.onButtonPress = options.onButtonPress;
    this.onButtonRelease = options.onButtonRelease;
  }

  /**
   * Start listening to keyboard input
   */
  start(): void {
    if (!this.enabled || Object.keys(this.mappings).length === 0) {
      return;
    }

    // Use dynamic import with then/catch to keep this method sync
    import('@futpib/node-global-key-listener')
      .then(({ GlobalKeyboardListener }) => {
        this.listener = new GlobalKeyboardListener();

        console.log('[Keyboard] Starting global keyboard listener');
        console.log('[Keyboard] Key mappings:', this.mappings);
        console.log('[Keyboard] Note: May require root/sudo or accessibility permissions');

        // Listen for key down events
        this.listener.addListener((e: any, down: any) => {
          if (e.state === 'DOWN') {
            this.handleKeyDown(e.name);
          } else if (e.state === 'UP') {
            this.handleKeyUp(e.name);
          }
        });
      })
      .catch((error: any) => {
        if (error.code === 'ERR_MODULE_NOT_FOUND' || error.code === 'MODULE_NOT_FOUND') {
          console.log('[Keyboard] ERROR: @futpib/node-global-key-listener not installed');
          console.log('[Keyboard] Install with: npm install @futpib/node-global-key-listener');
          console.log('[Keyboard] Note: Requires root/sudo or accessibility permissions');
        } else if (error.message?.includes('Permission denied')) {
          console.log('[Keyboard] ERROR: Permission denied');
          console.log('[Keyboard] On Linux, run with sudo or add user to input group:');
          console.log('[Keyboard]   sudo usermod -a -G input $USER');
          console.log('[Keyboard] On macOS, grant Accessibility permissions or run with sudo');
        } else {
          console.log(`[Keyboard] ERROR: ${error.message || error}`);
        }
      });
  }

  /**
   * Stop listening to keyboard input
   */
  stop(): void {
    if (this.listener) {
      try {
        this.listener.removeAllListeners?.();
        this.listener.kill?.();
        this.listener = null;
      } catch (error) {
        // Ignore errors during cleanup
      }
    }
  }

  /**
   * Handle key down event
   */
  private handleKeyDown(keyName: string): void {
    // Normalize key name (e.g., "1" or "NUMPAD_1")
    const normalizedKey = this.normalizeKeyName(keyName);

    // Check if this key is mapped to a button
    const buttonId = this.mappings[normalizedKey];
    if (buttonId) {
      this.onButtonPress(buttonId as ButtonId);
    }
  }

  /**
   * Handle key up event
   */
  private handleKeyUp(keyName: string): void {
    // Normalize key name
    const normalizedKey = this.normalizeKeyName(keyName);

    // Check if this key is mapped to a button
    const buttonId = this.mappings[normalizedKey];
    if (buttonId) {
      this.onButtonRelease(buttonId as ButtonId);
    }
  }

  /**
   * Normalize key name to match config mappings
   */
  private normalizeKeyName(keyName: string): string {
    // Convert to lowercase and remove prefixes
    const normalized = keyName.toLowerCase();

    // Map common variations
    if (normalized === 'numpad_1' || normalized === 'kp_1') return '1';
    if (normalized === 'numpad_2' || normalized === 'kp_2') return '2';
    if (normalized === 'numpad_3' || normalized === 'kp_3') return '3';
    if (normalized === 'numpad_4' || normalized === 'kp_4') return '4';
    if (normalized === 'numpad_5' || normalized === 'kp_5') return '5';
    if (normalized === 'numpad_6' || normalized === 'kp_6') return '6';
    if (normalized === 'numpad_7' || normalized === 'kp_7') return '7';
    if (normalized === 'numpad_8' || normalized === 'kp_8') return '8';
    if (normalized === 'numpad_9' || normalized === 'kp_9') return '9';
    if (normalized === 'numpad_0' || normalized === 'kp_0') return '0';

    return normalized;
  }

  /**
   * Update configuration
   */
  updateConfig(enabled: boolean, mappings: Record<string, string>): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;
    this.mappings = mappings;

    if (!wasEnabled && enabled) {
      // Start if we weren't enabled before
      this.start();
    } else if (wasEnabled && !enabled) {
      // Stop if we were enabled before
      this.stop();
    }
  }
}
