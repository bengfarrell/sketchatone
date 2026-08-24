/** Tests for the device-list helper functions in server/hidDevice. */

import { describe, expect, it } from "vitest";

import {
  isStandardDigitizer,
  pickAuxInterfaces,
  pickBestMatch,
  pickDigitizerInterface,
} from "../../../src/tablet/server/hidDevice.js";
import { makeConfig, makeDevice, makeIdentifier } from "./helpers.js";

function matchFor(name: string) {
  const cfg = makeConfig({ name, identifiers: [makeIdentifier()] });
  return { config: cfg, identifier: cfg.digitizerIdentifiers[0] };
}

describe("isStandardDigitizer", () => {
  it("matches only usage page 0x0D", () => {
    expect(isStandardDigitizer(makeDevice({ usagePage: 0x0D }))).toBe(true);
    expect(isStandardDigitizer(makeDevice({ usagePage: 0x01 }))).toBe(false);
  });
});

describe("pickDigitizerInterface", () => {
  it("prefers the standard digitizer", () => {
    const pen = makeDevice({ path: "pen", interfaceNumber: 1, usagePage: 0x0D });
    const vendor = makeDevice({ path: "vendor", interfaceNumber: 0, usagePage: 0xFF0A });
    expect(pickDigitizerInterface([vendor, pen])).toBe(pen);
  });

  it("falls back to highest usage page when no digitizer present", () => {
    const a = makeDevice({ path: "a", interfaceNumber: 0, usagePage: 0xFF00 });
    const b = makeDevice({ path: "b", interfaceNumber: 1, usagePage: 0xFF0A });
    expect(pickDigitizerInterface([a, b])).toBe(b);
  });

  it("returns null for empty list", () => {
    expect(pickDigitizerInterface([])).toBeNull();
  });
});

describe("pickBestMatch", () => {
  const artisul = matchFor("Artisul A1201");
  const gaomon = matchFor("Gaomon S630");
  const huion = matchFor("Huion H640P");

  it("picks the manufacturer-matching candidate over the first one", () => {
    const picked = pickBestMatch([artisul, gaomon, huion], "Huion Tablet_H640P", "HUION");
    expect(picked.config.name).toBe("Huion H640P");
  });

  it("falls back to model substring when manufacturer string is missing", () => {
    const picked = pickBestMatch([artisul, gaomon, huion], "Tablet H640P", "");
    expect(picked.config.name).toBe("Huion H640P");
  });

  it("returns the first candidate when nothing distinguishes them", () => {
    const picked = pickBestMatch([artisul, gaomon, huion], "Unknown Tablet", "Generic");
    expect(picked.config.name).toBe("Artisul A1201");
  });

  it("is case-insensitive for manufacturer comparison", () => {
    const picked = pickBestMatch([artisul, huion], "anything", "huion");
    expect(picked.config.name).toBe("Huion H640P");
  });
});

describe("pickAuxInterfaces", () => {
  it("excludes pen and dedupes by path", () => {
    const pen = makeDevice({ path: "pen", interfaceNumber: 0, usagePage: 0x0D });
    const kbA = makeDevice({ path: "aux", interfaceNumber: 1, usagePage: 0x01 });
    const consumerA = makeDevice({ path: "aux", interfaceNumber: 1, usagePage: 0x0C });
    const consumerB = makeDevice({ path: "aux2", interfaceNumber: 2, usagePage: 0x0C });
    const out = pickAuxInterfaces([pen, kbA, consumerA, consumerB]);
    const paths = out.map((d) => d.path);
    expect(paths).not.toContain("pen");
    expect(paths.filter((p) => p === "aux").length).toBe(1);
    expect(paths).toContain("aux2");
  });

  it("skips aux interfaces sharing the pen's interface number", () => {
    const pen = makeDevice({ path: "pen", interfaceNumber: 0, usagePage: 0x0D });
    const auxOnPen = makeDevice({ path: "pen-aux", interfaceNumber: 0, usagePage: 0x01 });
    const auxSeparate = makeDevice({ path: "aux", interfaceNumber: 2, usagePage: 0x01 });
    const out = pickAuxInterfaces([pen, auxOnPen, auxSeparate]);
    expect(out.map((d) => d.path)).toEqual(["aux"]);
  });

  it("ignores non-aux usage pages", () => {
    const pen = makeDevice({ path: "pen", interfaceNumber: 0, usagePage: 0x0D });
    const other = makeDevice({ path: "other", interfaceNumber: 3, usagePage: 0xFF00 });
    expect(pickAuxInterfaces([pen, other])).toEqual([]);
  });
});
