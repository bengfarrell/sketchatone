/** Convert OTD report objects into the websocket event shape the visualizer consumes. */

import { TabletConfiguration } from "../otd/configLoader.js";
import { ParsedReport } from "../otd/parsers/index.js";

/**
 * Normalized tablet event broadcast to clients.
 *
 * Coordinate ranges:
 *     x, y       0.0 .. 1.0 (origin top-left)
 *     pressure   0.0 .. 1.0
 *     tiltX, Y   -1.0 .. 1.0
 *     tiltXY     0.0 .. 1.0 (magnitude)
 */
export interface TabletEvent {
  type: "tablet-data";
  timestamp: number;
  state: "none" | "hover" | "contact";
  x: number;
  y: number;
  pressure: number;
  tiltX: number;
  tiltY: number;
  tiltXY: number;
  primaryButtonPressed: boolean;
  secondaryButtonPressed: boolean;
  auxCodes: number[];
}

function blankEvent(): TabletEvent {
  return {
    type: "tablet-data",
    timestamp: 0,
    state: "none",
    x: 0, y: 0, pressure: 0,
    tiltX: 0, tiltY: 0, tiltXY: 0,
    primaryButtonPressed: false,
    secondaryButtonPressed: false,
    auxCodes: [],
  };
}

function clamp01(n: number): number { return Math.min(1.0, Math.max(0.0, n)); }
function clampUnit(n: number): number { return Math.max(-1.0, Math.min(1.0, n)); }

function hasPosition(r: ParsedReport): r is ParsedReport & {
  position: [number, number];
  pressure?: number;
  penButtons?: boolean[];
  tilt?: [number, number];
} {
  return (r as any).position !== undefined;
}

/** Stateful adapter: combines successive tablet + aux reports into events. */
export class EventAdapter {
  private maxX: number;
  private maxY: number;
  private maxP: number;
  private auxCodesBySlot = new Map<string, number[]>();
  private inRange = false;

  constructor(public config: TabletConfiguration) {
    this.maxX = Math.max(1, config.specifications.digitizerMaxX);
    this.maxY = Math.max(1, config.specifications.digitizerMaxY);
    this.maxP = Math.max(1, config.specifications.penMaxPressure);
  }

  /**
   * Replace the normalization denominators (e.g. with values read from
   * the device's HID report descriptor when the OTD config's vendor-mode
   * values don't match the interface we actually opened).
   */
  overrideRanges(opts: { maxX?: number; maxY?: number; maxPressure?: number }): void {
    if (opts.maxX) this.maxX = Math.max(1, Math.trunc(opts.maxX));
    if (opts.maxY) this.maxY = Math.max(1, Math.trunc(opts.maxY));
    if (opts.maxPressure) this.maxP = Math.max(1, Math.trunc(opts.maxPressure));
  }

  private nowMs(): number { return Date.now(); }

  currentAuxCodes(): number[] {
    const seen = new Set<number>();
    const out: number[] = [];
    for (const codes of this.auxCodesBySlot.values()) {
      for (const c of codes) {
        if (!seen.has(c)) { seen.add(c); out.push(c); }
      }
    }
    return out;
  }

  /**
   * Record the active scan codes for one (path, reportId) slot.
   *
   * Composite aux interfaces multiplex several top-level collections
   * over a single IOHIDDevice; keying state per report ID prevents a
   * release on one collection from clobbering held buttons on
   * another. Returns true if the union across all slots changed.
   */
  updateAuxCodes(path: string, reportId: number, codes: number[]): boolean {
    const prev = this.currentAuxCodes();
    const slot = `${path}:${reportId}`;
    if (codes.length > 0) {
      this.auxCodesBySlot.set(slot, [...codes]);
    } else {
      this.auxCodesBySlot.delete(slot);
    }
    const next = this.currentAuxCodes();
    if (prev.length !== next.length) return true;
    for (let i = 0; i < prev.length; i++) if (prev[i] !== next[i]) return true;
    return false;
  }

  emptyEvent(): TabletEvent {
    const ev = blankEvent();
    ev.timestamp = this.nowMs();
    ev.auxCodes = this.currentAuxCodes();
    return ev;
  }

  /** Translate a parsed OTD report into a TabletEvent, or null to skip. */
  adapt(report: ParsedReport): TabletEvent | null {
    if (report.kind === "OutOfRangeReport") {
      this.inRange = false;
      return this.emptyEvent();
    }
    if (hasPosition(report)) {
      this.inRange = true;
      const [xRaw, yRaw] = report.position;
      const ev = this.emptyEvent();
      ev.x = clamp01(xRaw / this.maxX);
      ev.y = clamp01(yRaw / this.maxY);
      ev.pressure = clamp01((report.pressure ?? 0) / this.maxP);
      const penButtons = report.penButtons ?? [];
      ev.primaryButtonPressed = penButtons.length > 0 && !!penButtons[0];
      ev.secondaryButtonPressed = penButtons.length > 1 && !!penButtons[1];
      if (report.tilt) {
        const [tx, ty] = report.tilt;
        ev.tiltX = clampUnit(tx / 127.0);
        ev.tiltY = clampUnit(ty / 127.0);
        ev.tiltXY = Math.min(1.0, Math.hypot(ev.tiltX, ev.tiltY));
      }
      ev.state = ev.pressure > 0 ? "contact" : "hover";
      return ev;
    }
    return null;
  }
}
