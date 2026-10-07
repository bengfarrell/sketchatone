/** Tests for the raw HID aux scan-code parser. */

import { describe, expect, it } from "vitest";

import { parseAuxReport } from "../../../src/tablet/server/auxReport.js";

function encoded(reportId: number, page: number, code: number): number {
  return (
    ((reportId & 0xFF) << 24) |
    ((page & 0xFF) << 16) |
    (code & 0xFFFF)
  ) >>> 0;
}

function b(...bs: number[]): Uint8Array { return new Uint8Array(bs); }

describe("parseAuxReport", () => {
  it("empty input returns zero id and no codes", () => {
    expect(parseAuxReport(new Uint8Array())).toEqual({ reportId: 0, codes: [] });
  });

  it("keyboard 8-byte boot layout yields chorded code", () => {
    const data = b(2, 0x01, 0x00, 0x1E, 0, 0, 0, 0, 0);
    expect(parseAuxReport(data)).toEqual({
      reportId: 2,
      codes: [encoded(2, 0x07, (0x01 << 8) | 0x1E)],
    });
  });

  it("keyboard 7-byte compact layout", () => {
    const data = b(3, 0x00, 0x04, 0, 0, 0, 0, 0);
    expect(parseAuxReport(data)).toEqual({
      reportId: 3,
      codes: [encoded(3, 0x07, 0x04)],
    });
  });

  it("keyboard modifier-only emits one code per bit", () => {
    const data = b(4, 0x03, 0x00, 0, 0, 0, 0, 0, 0);
    expect(parseAuxReport(data)).toEqual({
      reportId: 4,
      codes: [
        encoded(4, 0x07, 0xE000 | 0x01),
        encoded(4, 0x07, 0xE000 | 0x02),
      ],
    });
  });

  it("keyboard duplicate keys dedup preserves order", () => {
    const data = b(5, 0x00, 0x00, 0x05, 0x05, 0x07, 0, 0, 0);
    expect(parseAuxReport(data)).toEqual({
      reportId: 5,
      codes: [
        encoded(5, 0x07, 0x05),
        encoded(5, 0x07, 0x07),
      ],
    });
  });

  it("consumer 2-byte report combines LE code", () => {
    const data = b(1, 0xB5, 0x00);
    expect(parseAuxReport(data)).toEqual({
      reportId: 1,
      codes: [encoded(1, 0x0C, 0x00B5)],
    });
  });

  it("consumer 1-byte report", () => {
    expect(parseAuxReport(b(6, 0x10))).toEqual({
      reportId: 6,
      codes: [encoded(6, 0x0C, 0x10)],
    });
  });

  it("consumer 3-byte report uses first two bytes", () => {
    expect(parseAuxReport(b(7, 0xCD, 0x00, 0xFF))).toEqual({
      reportId: 7,
      codes: [encoded(7, 0x0C, 0x00CD)],
    });
  });

  it("consumer zero payload yields no codes but keeps id", () => {
    expect(parseAuxReport(b(9, 0x00, 0x00))).toEqual({ reportId: 9, codes: [] });
  });

  it("generic fallback encodes position and value", () => {
    const data = b(8, 0x00, 0x11, 0x00, 0x22);
    expect(parseAuxReport(data)).toEqual({
      reportId: 8,
      codes: [
        encoded(8, 0xFF, (1 << 8) | 0x11),
        encoded(8, 0xFF, (3 << 8) | 0x22),
      ],
    });
  });

  it("codes are unique per report id", () => {
    const a = parseAuxReport(b(1, 0x00, 0x00, 0x04, 0, 0, 0, 0, 0));
    const c = parseAuxReport(b(2, 0x00, 0x00, 0x04, 0, 0, 0, 0, 0));
    expect(a.codes).not.toEqual(c.codes);
    expect(a.codes[0] >>> 24).toBe(1);
    expect(c.codes[0] >>> 24).toBe(2);
  });
});
