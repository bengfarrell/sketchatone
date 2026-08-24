/** Tests for OTD configuration loading and indexing. */

import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  ConfigIndex,
  loadAllConfigs,
  loadConfigFile,
} from "../../../src/tablet/otd/configLoader.js";

let tmpDir = "";

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "sketchatone-cfg-"));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

interface Payload { [k: string]: unknown }

interface SamplePayloadOpts {
  name?: string; vid?: number; pid?: number; irl?: number | null;
  parser?: string;
}

function samplePayload(opts: SamplePayloadOpts = {}): Payload {
  const {
    name = "Maker Test 100",
    vid = 0x256C,
    pid = 0x006E,
    irl = 12,
    parser = "OpenTabletDriver.Plugin.Tablet.TabletReportParser",
  } = opts;
  return {
    Name: name,
    Attributes: { libinputoverride: "1" },
    DigitizerIdentifiers: [{
      VendorID: vid,
      ProductID: pid,
      InputReportLength: irl,
      OutputReportLength: 64,
      ReportParser: parser,
      DeviceStrings: { 1: "Tablet" },
      InitializationStrings: [200, 201],
      FeatureInitReport: [Buffer.from([0x02, 0x03]).toString("base64")],
      OutputInitReport: [[2, 0xB0, 0x04]],
    }],
    Specifications: {
      Digitizer: { Width: 152.4, Height: 95.25, MaxX: 15200, MaxY: 9500 },
      Pen: { MaxPressure: 8191, ButtonCount: 2 },
      AuxiliaryButtons: { ButtonCount: 8 },
    },
  };
}

async function writeConfig(name: string, payload: Payload): Promise<string> {
  const p = path.join(tmpDir, name);
  await fs.writeFile(p, JSON.stringify(payload), "utf-8");
  return p;
}

function asBytes(arr: Uint8Array): number[] { return Array.from(arr); }

describe("loadConfigFile", () => {
  it("parses specs and identifier", async () => {
    const p = await writeConfig("tablet.json", samplePayload());
    const cfg = await loadConfigFile(p);
    expect(cfg.name).toBe("Maker Test 100");
    expect(cfg.manufacturer).toBe("Maker");
    expect(cfg.model).toBe("Test 100");
    expect(cfg.libinputOverride).toBe(true);
    expect(cfg.specifications.digitizerMaxX).toBe(15200);
    expect(cfg.specifications.penMaxPressure).toBe(8191);
    expect(cfg.specifications.auxButtonCount).toBe(8);

    expect(cfg.digitizerIdentifiers.length).toBe(1);
    const ident = cfg.digitizerIdentifiers[0];
    expect(ident.vendorId).toBe(0x256C);
    expect(ident.productId).toBe(0x006E);
    expect(ident.inputReportLength).toBe(12);
    expect(ident.initializationStrings).toEqual([200, 201]);
    expect(ident.featureInitReports.length).toBe(1);
    expect(asBytes(ident.featureInitReports[0])).toEqual([0x02, 0x03]);
    expect(ident.outputInitReports.length).toBe(1);
    expect(asBytes(ident.outputInitReports[0])).toEqual([2, 0xB0, 0x04]);
  });

  it("handles missing optional sections", async () => {
    const p = await writeConfig("bare.json", {
      Name: "Bare Tablet",
      DigitizerIdentifiers: [{
        VendorID: 1, ProductID: 2,
        ReportParser: "OpenTabletDriver.Plugin.Tablet.TabletReportParser",
      }],
    });
    const cfg = await loadConfigFile(p);
    expect(cfg.specifications.digitizerMaxX).toBe(0);
    expect(cfg.libinputOverride).toBe(false);
    expect(cfg.digitizerIdentifiers[0].inputReportLength).toBeNull();
    expect(cfg.digitizerIdentifiers[0].initializationStrings).toEqual([]);
  });
});

describe("loadAllConfigs", () => {
  it("skips invalid files", async () => {
    await writeConfig("ok.json", samplePayload());
    await fs.writeFile(path.join(tmpDir, "broken.json"), "{not valid json", "utf-8");
    await fs.writeFile(path.join(tmpDir, "missing.json"), JSON.stringify({ foo: "bar" }), "utf-8");
    const cfgs = await loadAllConfigs(tmpDir);
    expect(cfgs.length).toBe(1);
    expect(cfgs[0].name).toBe("Maker Test 100");
  });
});

describe("ConfigIndex", () => {
  it("finds by vid/pid", async () => {
    const cfg = await loadConfigFile(await writeConfig("t.json", samplePayload()));
    const index = new ConfigIndex([cfg]);
    const matches = index.find(0x256C, 0x006E);
    expect(matches.length).toBe(1);
    expect(matches[0].config).toBe(cfg);
    expect(index.find(0xDEAD, 0xBEEF)).toEqual([]);
    expect(index.allVidPidPairs()).toEqual([[0x256C, 0x006E]]);
  });

  it("narrows by input report length", async () => {
    const a = await loadConfigFile(await writeConfig(
      "a.json", samplePayload({ name: "A One", irl: 12 })));
    const b = await loadConfigFile(await writeConfig(
      "b.json", samplePayload({ name: "B Two", irl: 64 })));
    const index = new ConfigIndex([a, b]);
    expect(index.find(0x256C, 0x006E, 12).map((m) => m.config.name)).toEqual(["A One"]);
    expect(index.find(0x256C, 0x006E, 64).map((m) => m.config.name)).toEqual(["B Two"]);
  });

  it("falls back when no irl matches", async () => {
    const cfg = await loadConfigFile(await writeConfig(
      "t.json", samplePayload({ irl: 12 })));
    const index = new ConfigIndex([cfg]);
    expect(index.find(0x256C, 0x006E, 99).length).toBe(1);
  });

  it("keeps identifiers with null report length", async () => {
    const payload = samplePayload();
    (payload.DigitizerIdentifiers as any)[0].InputReportLength = null;
    const cfg = await loadConfigFile(await writeConfig("t.json", payload));
    const index = new ConfigIndex([cfg]);
    expect(index.find(0x256C, 0x006E, 64).length).toBe(1);
  });
});
