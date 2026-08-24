/** Byte-level parsing tests for the OTD report classes. */

import { describe, expect, it } from "vitest";

import {
  AuxReport,
  StandardDigitizerReport,
  TabletReport,
  TiltTabletReport,
  bit,
  s8,
  u16le,
} from "../../../src/tablet/otd/reports.js";

function b(...bs: number[]): Uint8Array { return new Uint8Array(bs); }

describe("helpers", () => {
  it("u16le/s8/bit behave as expected", () => {
    expect(u16le(b(0, 0, 0x34, 0x12), 2)).toBe(0x1234);
    expect(s8(0x7F)).toBe(127);
    expect(s8(0x80)).toBe(-128);
    expect(s8(0xFF)).toBe(-1);
    expect(bit(0b0000_0010, 1)).toBe(true);
    expect(bit(0b0000_0010, 0)).toBe(false);
  });
});

describe("TabletReport", () => {
  it("parses position, pressure and pen buttons", () => {
    const data = b(0x10, 0b0000_0110, 0x02, 0x01, 0x04, 0x03, 0x06, 0x05);
    const r = TabletReport.parse(data);
    expect(r.position).toEqual([0x0102, 0x0304]);
    expect(r.pressure).toBe(0x0506);
    expect(r.penButtons).toEqual([true, true, false]);
  });
});

describe("TiltTabletReport", () => {
  it("decodes signed tilt and supports inversion", () => {
    const data = b(0x01, 0b0000_0010, 0, 0, 0, 0, 0, 0, 0, 0, 0xFE, 0x05);
    const r = TiltTabletReport.parse(data);
    expect(r.tilt).toEqual([-2, 5]);
    const inv = TiltTabletReport.parse(data, true, true);
    expect(inv.tilt).toEqual([2, -5]);
    expect(r.penButtons).toEqual([true, false, false]);
  });
});

describe("StandardDigitizerReport", () => {
  it("pen sample sets in-range and inverts tilt Y by default", () => {
    const status = 0b1000_0001;
    const data = b(0x07, status, 0x10, 0x00, 0x20, 0x00, 0x80, 0x01, 0x05, 0xFB);
    const r = StandardDigitizerReport.parse(data);
    expect(r.position).toEqual([0x0010, 0x0020]);
    expect(r.pressure).toBe(0x0180);
    expect(r.inRange).toBe(true);
    expect(r.tilt).toEqual([5, 5]);
    expect(r.penButtons).toEqual([false, false]);
  });

  it("eraser bit is bit 2", () => {
    const status = 0b1000_0100;
    const data = b(0x07, status, 0, 0, 0, 0, 0, 0, 0, 0);
    const r = StandardDigitizerReport.parse(data);
    expect(r.eraser).toBe(true);
    expect(r.penButtons).toEqual([false, true]);
  });

  it("8-byte packet keeps zero tilt", () => {
    const status = 0b1000_0001;
    const data = b(0x07, status, 0, 0, 0, 0, 0, 0);
    const r = StandardDigitizerReport.parse(data);
    expect(r.tilt).toEqual([0, 0]);
  });
});

describe("AuxReport", () => {
  it("parses four buttons from byte three", () => {
    const r = AuxReport.parse(b(0x06, 0, 0, 0b0000_1011));
    expect(r.auxButtons).toEqual([true, true, false, true]);
  });
});
