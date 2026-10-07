/** Tests for the minimal HID report-descriptor parser. */

import { describe, expect, it } from "vitest";

import {
  USAGE_PAGE_DIGITIZER,
  USAGE_PAGE_GENERIC_DESKTOP,
  parseDescriptor,
  pickPenRanges,
} from "../../../src/tablet/server/hidDescriptor.js";

function concat(...parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function usagePage(value: number): Uint8Array {
  return new Uint8Array([0x05, value & 0xFF]);
}
function logicalMaxU16(value: number): Uint8Array {
  return new Uint8Array([0x26, value & 0xFF, (value >> 8) & 0xFF]);
}
function reportId(value: number): Uint8Array {
  return new Uint8Array([0x85, value & 0xFF]);
}
function usage(value: number): Uint8Array {
  return new Uint8Array([0x09, value & 0xFF]);
}
function input(flags = 0x02): Uint8Array {
  return new Uint8Array([0x81, flags & 0xFF]);
}

function buildPenDescriptor(opts: {
  reportId: number; xMax: number; yMax: number; pressureMax: number;
}): Uint8Array {
  return concat(
    usagePage(USAGE_PAGE_GENERIC_DESKTOP),
    reportId(opts.reportId),
    logicalMaxU16(opts.xMax),
    usage(0x30),
    input(),
    logicalMaxU16(opts.yMax),
    usage(0x31),
    input(),
    usagePage(USAGE_PAGE_DIGITIZER),
    logicalMaxU16(opts.pressureMax),
    usage(0x30),
    input(),
  );
}

describe("parseDescriptor", () => {
  it("extracts x/y/pressure for a single report ID", () => {
    const desc = buildPenDescriptor({
      reportId: 7, xMax: 15200, yMax: 9500, pressureMax: 8191,
    });
    const parsed = parseDescriptor(desc);
    expect([...parsed.keys()]).toEqual([7]);
    const r = parsed.get(7)!;
    expect(r.xMax).toBe(15200);
    expect(r.yMax).toBe(9500);
    expect(r.pressureMax).toBe(8191);
  });

  it("parses multiple report IDs", () => {
    const desc = concat(
      buildPenDescriptor({ reportId: 1, xMax: 100, yMax: 200, pressureMax: 1024 }),
      buildPenDescriptor({ reportId: 2, xMax: 300, yMax: 400, pressureMax: 2048 }),
    );
    const parsed = parseDescriptor(desc);
    expect(parsed.get(1)!.xMax).toBe(100);
    expect(parsed.get(1)!.yMax).toBe(200);
    expect(parsed.get(2)!.xMax).toBe(300);
    expect(parsed.get(2)!.pressureMax).toBe(2048);
  });

  it("ignores unrelated usage pages", () => {
    const desc = concat(
      usagePage(0x07), // Keyboard
      reportId(3),
      logicalMaxU16(0xFF),
      usage(0x04),
      input(),
    );
    const r = parseDescriptor(desc).get(3)!;
    expect(r.xMax).toBeNull();
    expect(r.yMax).toBeNull();
    expect(r.pressureMax).toBeNull();
  });
});

describe("pickPenRanges", () => {
  it("returns first report with both x and y set", () => {
    const partial = concat(
      usagePage(USAGE_PAGE_GENERIC_DESKTOP),
      reportId(1),
      logicalMaxU16(50),
      usage(0x30),
      input(),
    );
    const full = buildPenDescriptor({
      reportId: 2, xMax: 500, yMax: 600, pressureMax: 4096,
    });
    const ranges = pickPenRanges(concat(partial, full));
    expect(ranges).not.toBeNull();
    expect(ranges!.xMax).toBe(500);
    expect(ranges!.yMax).toBe(600);
  });

  it("returns null when no x/y present", () => {
    expect(pickPenRanges(new Uint8Array())).toBeNull();
  });

  it("does not throw on truncated descriptor", () => {
    expect(() => parseDescriptor(new Uint8Array([0x26, 0xFF]))).not.toThrow();
  });
});
