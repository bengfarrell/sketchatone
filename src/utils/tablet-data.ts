/**
 * Tablet data normalization and formatting helpers
 * Provides the standard TabletData shape consumed by visualizers
 */

/**
 * Normalized tablet data - all values are normalized to standard ranges
 * x, y, pressure: 0-1
 * tiltX, tiltY: -1 to 1
 */
export interface TabletData {
    x: number;
    y: number;
    pressure: number;
    tiltX: number;
    tiltY: number;
    tiltXY: number;
    primaryButtonPressed: boolean;
    secondaryButtonPressed: boolean;
    button?: number;
    state?: string;
}

/**
 * Raw tablet event from various sources
 */
export interface TabletDataEvent {
    x?: number;
    y?: number;
    pressure?: number;
    tiltX?: number;
    tiltY?: number;
    button?: number;
    primaryButtonPressed?: boolean;
    secondaryButtonPressed?: boolean;
    state?: string;
    [key: string]: string | number | boolean | undefined;
}

/**
 * Normalize a raw tablet event into the standard TabletData shape
 */
export function normalizeTabletData(data: TabletDataEvent): TabletData {
    const normalizedX = typeof data.x === 'number' ? data.x : 0;
    const normalizedY = typeof data.y === 'number' ? data.y : 0;
    const normalizedPressure = typeof data.pressure === 'number' ? data.pressure : 0;
    const tiltX = typeof data.tiltX === 'number' ? data.tiltX : 0;
    const tiltY = typeof data.tiltY === 'number' ? data.tiltY : 0;
    const tiltXY = Math.sqrt(tiltX * tiltX + tiltY * tiltY) * Math.sign(tiltX * tiltY || 1);

    return {
        x: normalizedX,
        y: normalizedY,
        pressure: normalizedPressure,
        tiltX,
        tiltY,
        tiltXY: Math.min(1, Math.max(-1, tiltXY)),
        primaryButtonPressed: data.primaryButtonPressed ?? false,
        secondaryButtonPressed: data.secondaryButtonPressed ?? false,
        button: data.button,
        state: data.state,
    };
}

/**
 * Format a numeric value for display
 */
export function formatValue(value: number, decimals: number = 2): string {
    return value.toFixed(decimals);
}
