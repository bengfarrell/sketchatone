/**
 * Tablet Interaction Controller
 * Shared state model for tablet and pen interactions
 * Ported from midi-strummer project
 */

import { ReactiveController, ReactiveControllerHost } from 'lit';

/**
 * Shared state model for tablet and pen interactions
 */
export interface TabletInteractionState {
    // Tablet state
    tabletPressed: boolean;
    tabletX: number;
    tabletY: number;
    
    // Pen tilt state
    tiltPressed: boolean;
    tiltX: number;
    tiltY: number;
    tiltXY: number; // Combined tilt magnitude with sign
    tiltPressure: number;
    
    // Button states
    primaryButtonPressed: boolean;
    secondaryButtonPressed: boolean;
    tabletButtons: boolean[]; // Array of 8 tablet button states
    
    // Last interaction info
    lastHoveredString: number | null;
    lastPressedButton: number | null;
}

/**
 * Reactive controller that manages tablet interaction state
 * and notifies multiple host components when state changes
 */
export class TabletInteractionController implements ReactiveController {
    private hosts: Set<ReactiveControllerHost> = new Set();
    
    // Interaction state
    private _state: TabletInteractionState = {
        tabletPressed: false,
        tabletX: 0,
        tabletY: 0,
        
        tiltPressed: false,
        tiltX: 0,
        tiltY: 0,
        tiltXY: 0,
        tiltPressure: 0,
        
        primaryButtonPressed: false,
        secondaryButtonPressed: false,
        tabletButtons: Array(8).fill(false),
        
        lastHoveredString: null,
        lastPressedButton: null
    };
    
    constructor(host?: ReactiveControllerHost) {
        if (host) {
            this.addHost(host);
        }
    }
    
    /**
     * Add a host component to track
     */
    addHost(host: ReactiveControllerHost) {
        this.hosts.add(host);
        host.addController(this);
    }
    
    /**
     * Remove a host component
     */
    removeHost(host: ReactiveControllerHost) {
        this.hosts.delete(host);
    }
    
    /**
     * Notify all registered hosts to update
     */
    private notifyHosts() {
        this.hosts.forEach(host => host.requestUpdate());
    }
    
    // Lifecycle methods (required by ReactiveController)
    hostConnected() {
        // Called when host is connected to DOM
    }
    
    hostDisconnected() {
        // Called when host is disconnected from DOM
    }
    
    // State accessors
    get state(): Readonly<TabletInteractionState> {
        return this._state;
    }
    
    // Tablet methods
    setTabletPosition(x: number, y: number, pressed: boolean) {
        this._state.tabletX = x;
        this._state.tabletY = y;
        this._state.tabletPressed = pressed;
        this.notifyHosts();
    }
    
    setTabletPressed(pressed: boolean) {
        this._state.tabletPressed = pressed;
        this.notifyHosts();
    }
    
    // Pen tilt methods
    setTiltPosition(x: number, y: number, pressure: number, pressed: boolean, tiltXY?: number) {
        this._state.tiltX = x;
        this._state.tiltY = y;
        this._state.tiltPressure = pressure;
        this._state.tiltPressed = pressed;
        
        // Use provided tiltXY or calculate it
        if (tiltXY !== undefined) {
            this._state.tiltXY = tiltXY;
        } else {
            // Calculate tiltXY for backward compatibility
            const magnitude = Math.sqrt(x * x + y * y);
            const sign = (x * y) >= 0 ? 1 : -1;
            this._state.tiltXY = Math.max(-1, Math.min(1, magnitude * sign));
        }
        
        this.notifyHosts();
    }
    
    setTiltPressed(pressed: boolean) {
        this._state.tiltPressed = pressed;
        if (!pressed) {
            // Reset tilt when released
            this._state.tiltX = 0;
            this._state.tiltY = 0;
            this._state.tiltXY = 0;
            this._state.tiltPressure = 0;
        }
        this.notifyHosts();
    }
    
    // Button methods
    setPrimaryButton(pressed: boolean) {
        this._state.primaryButtonPressed = pressed;
        this.notifyHosts();
    }
    
    setSecondaryButton(pressed: boolean) {
        this._state.secondaryButtonPressed = pressed;
        this.notifyHosts();
    }
    
    setTabletButton(index: number, pressed: boolean) {
        if (index >= 0 && index < this._state.tabletButtons.length) {
            this._state.tabletButtons[index] = pressed;
            if (pressed) {
                this._state.lastPressedButton = index;
            }
            this.notifyHosts();
        }
    }
    
    // String interaction
    setLastHoveredString(stringIndex: number | null) {
        this._state.lastHoveredString = stringIndex;
        this.notifyHosts();
    }
    
    // Reset all state
    reset() {
        this._state = {
            tabletPressed: false,
            tabletX: 0,
            tabletY: 0,
            
            tiltPressed: false,
            tiltX: 0,
            tiltY: 0,
            tiltXY: 0,
            tiltPressure: 0,
            
            primaryButtonPressed: false,
            secondaryButtonPressed: false,
            tabletButtons: Array(8).fill(false),
            
            lastHoveredString: null,
            lastPressedButton: null
        };
        this.notifyHosts();
    }
}

// Singleton instance that can be shared across components
export const sharedTabletInteraction = new TabletInteractionController();
