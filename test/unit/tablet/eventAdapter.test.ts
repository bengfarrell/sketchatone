/** Tests for the EventAdapter (report → websocket event translation). */

import { describe, expect, it } from "vitest";

import {
  DeviceReport,
  OutOfRangeReport,
  StandardDigitizerReport,
  TabletReport,
  TiltTabletReport,
} from "../../../src/tablet/otd/reports.js";
import { EventAdapter } from "../../../src/tablet/server/eventAdapter.js";
import { makeConfig } from "./helpers.js";

function tabletReport(opts: {
  position: [number, number]; pressure?: number; penButtons?: boolean[];
}): TabletReport {
  const r = new TabletReport(new Uint8Array());
  r.position = opts.position;
  r.pressure = opts.pressure ?? 0;
  r.penButtons = opts.penButtons ?? [];
  return r;
}

function tiltReport(opts: {
  position?: [number, number]; pressure?: number;
  tilt: [number, number]; penButtons?: boolean[];
}): TiltTabletReport {
  const r = new TiltTabletReport(new Uint8Array());
  r.position = opts.position ?? [0, 0];
  r.pressure = opts.pressure ?? 0;
  r.tilt = opts.tilt;
  r.penButtons = opts.penButtons ?? [];
  return r;
}

describe("EventAdapter", () => {
  it("OutOfRangeReport emits empty event", () => {
    const adapter = new EventAdapter(makeConfig());
    const ev = adapter.adapt(new OutOfRangeReport(new Uint8Array()));
    expect(ev).not.toBeNull();
    expect(ev!.x).toBe(0);
    expect(ev!.y).toBe(0);
    expect(ev!.pressure).toBe(0);
    expect(ev!.state).toBe("none");
  });

  it("TabletReport normalizes position and pressure", () => {
    const adapter = new EventAdapter(makeConfig({
      maxX: 1000, maxY: 500, maxPressure: 8192,
    }));
    const ev = adapter.adapt(tabletReport({
      position: [500, 250], pressure: 4096, penButtons: [true, false, false],
    }));
    expect(ev).not.toBeNull();
    expect(ev!.x).toBe(0.5);
    expect(ev!.y).toBe(0.5);
    expect(ev!.pressure).toBe(0.5);
    expect(ev!.primaryButtonPressed).toBe(true);
    expect(ev!.secondaryButtonPressed).toBe(false);
    expect(ev!.state).toBe("contact");
  });

  it("hover state when pressure is zero", () => {
    const adapter = new EventAdapter(makeConfig());
    const ev = adapter.adapt(tabletReport({ position: [100, 50] }));
    expect(ev!.state).toBe("hover");
  });

  it("values clamp to unit range", () => {
    const adapter = new EventAdapter(makeConfig({
      maxX: 100, maxY: 100, maxPressure: 100,
    }));
    const ev = adapter.adapt(tabletReport({
      position: [10_000, -50], pressure: 999,
    }));
    expect(ev!.x).toBe(1);
    expect(ev!.y).toBe(0);
    expect(ev!.pressure).toBe(1);
  });

  it("overrideRanges replaces normalization denominators", () => {
    const adapter = new EventAdapter(makeConfig({
      maxX: 100, maxY: 100, maxPressure: 100,
    }));
    adapter.overrideRanges({ maxX: 1000, maxY: 500, maxPressure: 8192 });
    const ev = adapter.adapt(tabletReport({
      position: [500, 250], pressure: 4096,
    }));
    expect(ev!.x).toBe(0.5);
    expect(ev!.y).toBe(0.5);
    expect(ev!.pressure).toBe(0.5);
  });

  it("tilt magnitude and components", () => {
    const adapter = new EventAdapter(makeConfig());
    const ev = adapter.adapt(tiltReport({ tilt: [127, -127] }));
    expect(ev!.tiltX).toBe(1);
    expect(ev!.tiltY).toBe(-1);
    expect(ev!.tiltXY).toBe(1);
    const half = adapter.adapt(tiltReport({ tilt: [64, 0] }));
    expect(half!.tiltX).toBeCloseTo(64 / 127);
    expect(half!.tiltY).toBe(0);
  });

  it("StandardDigitizerReport routes through position branch", () => {
    const adapter = new EventAdapter(makeConfig({
      maxX: 1000, maxY: 1000, maxPressure: 1000,
    }));
    const r = new StandardDigitizerReport(new Uint8Array());
    r.position = [250, 500];
    r.pressure = 100;
    r.tilt = [0, 0];
    r.penButtons = [true, false];
    r.inRange = true;
    const ev = adapter.adapt(r);
    expect(ev!.x).toBe(0.25);
    expect(ev!.y).toBe(0.5);
    expect(ev!.primaryButtonPressed).toBe(true);
  });

  it("unknown DeviceReport returns null", () => {
    const adapter = new EventAdapter(makeConfig());
    expect(adapter.adapt(new DeviceReport(new Uint8Array([0])))).toBeNull();
  });

  it("aux codes multiplex across slots and dedup", () => {
    const adapter = new EventAdapter(makeConfig());
    const changedA = adapter.updateAuxCodes("path-a", 1, [0x01, 0x02]);
    const changedB = adapter.updateAuxCodes("path-b", 2, [0x02, 0x03]);
    expect(changedA).toBe(true);
    expect(changedB).toBe(true);
    expect(adapter.currentAuxCodes()).toEqual([0x01, 0x02, 0x03]);

    const released = adapter.updateAuxCodes("path-a", 1, []);
    expect(released).toBe(true);
    expect(adapter.currentAuxCodes()).toEqual([0x02, 0x03]);
  });

  it("aux code update with no change returns false", () => {
    const adapter = new EventAdapter(makeConfig());
    adapter.updateAuxCodes("p", 1, [0x10]);
    expect(adapter.updateAuxCodes("p", 1, [0x10])).toBe(false);
  });

  it("empty event includes current aux codes", () => {
    const adapter = new EventAdapter(makeConfig());
    adapter.updateAuxCodes("p", 1, [0xAB]);
    const ev = adapter.adapt(new OutOfRangeReport(new Uint8Array()));
    expect(ev!.auxCodes).toEqual([0xAB]);
  });

  it("emitted event has the expected shape", () => {
    const adapter = new EventAdapter(makeConfig());
    const ev = adapter.adapt(tabletReport({ position: [0, 0] }))!;
    expect(new Set(Object.keys(ev))).toEqual(new Set([
      "type", "timestamp", "state", "x", "y", "pressure",
      "tiltX", "tiltY", "tiltXY",
      "primaryButtonPressed", "secondaryButtonPressed", "auxCodes",
    ]));
  });
});
