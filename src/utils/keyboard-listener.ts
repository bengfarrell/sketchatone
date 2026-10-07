/**
 * Keyboard Listener for Server-Side Input
 *
 * System-level keyboard listener that works with systemd services.
 * Uses node-global-key-listener for global keyboard capture on Linux/macOS/Windows.
 * Requires root/sudo permissions or accessibility permissions on macOS.
 *
 * Emits raw normalized key characters; the server maps `key:<char>` to buttons.
 */

export interface KeyboardListenerOptions {
  enabled: boolean;
  onKeyPress: (key: string) => void;
  onKeyRelease: (key: string) => void;
}

export class KeyboardListener {
  private enabled: boolean;
  private onKeyPress: (key: string) => void;
  private onKeyRelease: (key: string) => void;
  private listener: any = null;

  constructor(options: KeyboardListenerOptions) {
    this.enabled = options.enabled;
    this.onKeyPress = options.onKeyPress;
    this.onKeyRelease = options.onKeyRelease;
  }

  start(): void {
    if (!this.enabled) {
      return;
    }

    import('@futpib/node-global-key-listener')
      .then(({ GlobalKeyboardListener }) => {
        this.listener = new GlobalKeyboardListener();

        console.log('[Keyboard] Starting global keyboard listener');
        console.log('[Keyboard] Note: May require root/sudo or accessibility permissions');

        this.listener.addListener((e: any) => {
          const key = this.normalizeKeyName(e.name);
          if (!key) return;
          if (e.state === 'DOWN') {
            this.onKeyPress(key);
          } else if (e.state === 'UP') {
            this.onKeyRelease(key);
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
   * Normalize a raw key name from the global listener into a compact character
   * or short symbolic name. Returns an empty string if the key should be ignored.
   */
  private normalizeKeyName(keyName: string): string {
    if (!keyName) return '';
    const normalized = keyName.toLowerCase();

    if (normalized.startsWith('numpad_')) return normalized.slice(7);
    if (normalized.startsWith('kp_')) return normalized.slice(3);

    return normalized;
  }

  updateConfig(enabled: boolean): void {
    const wasEnabled = this.enabled;
    this.enabled = enabled;

    if (!wasEnabled && enabled) {
      this.start();
    } else if (wasEnabled && !enabled) {
      this.stop();
    }
  }
}
