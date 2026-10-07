/** Tests for the OTD parser registry and per-vendor dispatch. */

import { describe, expect, it } from "vitest";

import {
  HuionTiltReportParser,
  InspiroyAuxReport,
  InspiroyReportParser,
  StandardDigitizerReportParser,
  UCLogicAuxReport,
  UCLogicTiltReportParser,
  UnknownParserError,
  XPPenAuxReport,
  XPPenReportParser,
  XPPenTabletOverflowReport,
  XPPenTabletReport,
  getParser,
  knownParsers,
} from "../../../src/tablet/otd/parsers/index.js";
import {
  DeviceReport,
  OutOfRangeReport,
  StandardDigitizerReport,
  TiltTabletReport,
} from "../../../src/tablet/otd/reports.js";

function b(...bs: number[]): Uint8Array { return new Uint8Array(bs); }
function repeat(len: number, ...prefix: number[]): Uint8Array {
  const out = new Uint8Array(prefix.length + len);
  out.set(prefix, 0);
  return out;
}

describe("registry", () => {
  it("lists known parsers", () => {
    const names = knownParsers();
    expect(names).toContain("OpenTabletDriver.Plugin.Tablet.TabletReportParser");
    expect(names).toContain("OpenTabletDriver.Configurations.Parsers.Huion.InspiroyReportParser");
  });

  it("returns a fresh instance per call", () => {
    const p1 = getParser("OpenTabletDriver.Plugin.Tablet.TabletReportParser");
    const p2 = getParser("OpenTabletDriver.Plugin.Tablet.TabletReportParser");
    expect(p1).not.toBe(p2);
    expect(typeof p1.parse).toBe("function");
  });

  it("throws UnknownParserError for unknown name", () => {
    expect(() => getParser("Made.Up.Parser")).toThrowError(UnknownParserError);
  });
});

describe("StandardDigitizerReportParser", () => {
  it("returns null for short packet", () => {
    const parser = new StandardDigitizerReportParser();
    expect(parser.parse(b(0x07, 0x80, 0x00))).toBeNull();
  });

  it("status zero is out of range", () => {
    const parser = new StandardDigitizerReportParser();
    const res = parser.parse(b(0x07, 0x00, 0, 0, 0, 0, 0, 0));
    expect(res).toBeInstanceOf(OutOfRangeReport);
  });

  it("ignores non-pen status (bit 7 clear and nonzero)", () => {
    const parser = new StandardDigitizerReportParser();
    expect(parser.parse(b(0x07, 0x42, 0, 0, 0, 0, 0, 0))).toBeNull();
  });

  it("returns pen sample when bit 7 set", () => {
    const parser = new StandardDigitizerReportParser();
    const res = parser.parse(b(0x07, 0x81, 0x10, 0x00, 0x20, 0x00, 0x00, 0x01));
    expect(res).toBeInstanceOf(StandardDigitizerReport);
    expect((res as StandardDigitizerReport).position).toEqual([0x10, 0x20]);
  });
});

describe("UCLogicTiltReportParser", () => {
  it("routes to aux when status bit 6 set", () => {
    const parser = new UCLogicTiltReportParser();
    const auxStatus = 1 << 6;
    const data = b(1, auxStatus, 0, 0, 0xFF, 0x00, 0x0F, 0, 0, 0, 0, 0);
    const res = parser.parse(data);
    expect(res).toBeInstanceOf(UCLogicAuxReport);
    const aux = res as UCLogicAuxReport;
    expect(aux.auxButtons.length).toBe(20);
    expect(aux.auxButtons.slice(0, 8)).toEqual([true, true, true, true, true, true, true, true]);
  });

  it("falls through to tilt tablet report", () => {
    const parser = new UCLogicTiltReportParser();
    const res = parser.parse(b(1, 0x80, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0));
    expect(res).toBeInstanceOf(TiltTabletReport);
  });
});

describe("InspiroyReportParser", () => {
  it("dispatches all status branches", () => {
    const parser = new InspiroyReportParser();
    expect(parser.parse(repeat(10, 1, 0xE0))).toBeInstanceOf(UCLogicAuxReport);
    expect(parser.parse(repeat(10, 1, 0x00))).toBeInstanceOf(OutOfRangeReport);
    expect(parser.parse(repeat(10, 1, 0x80))).toBeInstanceOf(TiltTabletReport);
    expect(parser.parse(repeat(10, 1, 0xF1)).kind).toBe("InspiroyRelWheelReport");
    expect(parser.parse(repeat(10, 1, 0x05))).toBeInstanceOf(DeviceReport);
  });
});

describe("HuionTiltReportParser", () => {
  it("routes aux and wheel", () => {
    const parser = new HuionTiltReportParser();
    expect(parser.parse(repeat(10, 1, 0xE0))).toBeInstanceOf(InspiroyAuxReport);
    expect(parser.parse(repeat(10, 1, 0xF0)).kind).toBe("HuionWheelReport");
  });
});

describe("XPPenReportParser", () => {
  it("dispatches correctly", () => {
    const parser = new XPPenReportParser();
    expect(parser.parse(repeat(10, 1, 0xC0))).toBeInstanceOf(OutOfRangeReport);
    const auxStatus = 1 << 4;
    expect(parser.parse(repeat(14, 1, auxStatus))).toBeInstanceOf(XPPenAuxReport);
    expect(parser.parse(repeat(14, 1, 0x80))).toBeInstanceOf(XPPenTabletOverflowReport);
    expect(parser.parse(repeat(8, 1, 0x80))).toBeInstanceOf(XPPenTabletReport);
  });
});
