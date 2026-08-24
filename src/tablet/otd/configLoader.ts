/** Loader and matcher for vendored OpenTabletDriver configurations. */

import { promises as fs } from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Default location of the OTD JSON configs. The Node and Python ports
 * share the same vendored copy under <repo-root>/configs to avoid drift.
 */
export const CONFIGS_ROOT = path.resolve(__dirname, "..", "..", "..", "configs");

export interface DigitizerIdentifier {
  vendorId: number;
  productId: number;
  inputReportLength: number | null;
  outputReportLength: number | null;
  reportParser: string;
  deviceStrings: Record<string, string>;
  initializationStrings: number[];
  featureInitReports: Uint8Array[];
  outputInitReports: Uint8Array[];
}

export interface TabletSpecifications {
  digitizerWidthMm: number;
  digitizerHeightMm: number;
  digitizerMaxX: number;
  digitizerMaxY: number;
  penMaxPressure: number;
  penButtonCount: number;
  auxButtonCount: number;
}

export class TabletConfiguration {
  constructor(
    public name: string,
    public sourcePath: string,
    public specifications: TabletSpecifications,
    public digitizerIdentifiers: DigitizerIdentifier[],
    public libinputOverride = false,
  ) {}

  get manufacturer(): string { return this.name.split(" ", 1)[0]; }
  get model(): string {
    const idx = this.name.indexOf(" ");
    return idx === -1 ? this.name : this.name.slice(idx + 1);
  }
}

function parseSpecs(raw: any): TabletSpecifications {
  const digi = raw?.Digitizer ?? {};
  const pen = raw?.Pen ?? {};
  const aux = raw?.AuxiliaryButtons ?? {};
  return {
    digitizerWidthMm: Number(digi.Width ?? 0) || 0,
    digitizerHeightMm: Number(digi.Height ?? 0) || 0,
    digitizerMaxX: Number(digi.MaxX ?? 0) || 0,
    digitizerMaxY: Number(digi.MaxY ?? 0) || 0,
    penMaxPressure: Number(pen.MaxPressure ?? 0) || 0,
    penButtonCount: Number(pen.ButtonCount ?? 0) || 0,
    auxButtonCount: Number(aux.ButtonCount ?? 0) || 0,
  };
}

/** OTD serializes byte arrays in JSON as base64 strings or int arrays. */
function decodeReport(value: unknown): Uint8Array {
  if (typeof value === "string") {
    return new Uint8Array(Buffer.from(value, "base64"));
  }
  if (Array.isArray(value)) {
    return new Uint8Array(value.map((b) => Number(b) & 0xFF));
  }
  return new Uint8Array();
}

function requireField<T>(obj: any, key: string): T {
  if (obj == null || !(key in obj)) {
    throw new Error(`missing required field: ${key}`);
  }
  return obj[key] as T;
}

function parseIdentifier(raw: any): DigitizerIdentifier {
  const deviceStrings: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw.DeviceStrings ?? {})) {
    deviceStrings[String(k)] = String(v);
  }
  const initStrings = (raw.InitializationStrings ?? []).map(
    (i: number) => Number(i) & 0xFF,
  );
  const featureInit = (raw.FeatureInitReport ?? [])
    .map(decodeReport).filter((b: Uint8Array) => b.length > 0);
  const outputInit = (raw.OutputInitReport ?? [])
    .map(decodeReport).filter((b: Uint8Array) => b.length > 0);
  return {
    vendorId: Number(requireField(raw, "VendorID")),
    productId: Number(requireField(raw, "ProductID")),
    inputReportLength: raw.InputReportLength ?? null,
    outputReportLength: raw.OutputReportLength ?? null,
    reportParser: String(requireField(raw, "ReportParser")),
    deviceStrings,
    initializationStrings: initStrings,
    featureInitReports: featureInit,
    outputInitReports: outputInit,
  };
}

export async function loadConfigFile(filePath: string): Promise<TabletConfiguration> {
  const raw = JSON.parse(await fs.readFile(filePath, "utf-8"));
  const attrs = raw.Attributes ?? {};
  return new TabletConfiguration(
    String(requireField(raw, "Name")),
    filePath,
    parseSpecs(raw.Specifications ?? {}),
    (raw.DigitizerIdentifiers ?? []).map(parseIdentifier),
    String(attrs.libinputoverride ?? "0") !== "0",
  );
}

async function* walkJson(dir: string): AsyncGenerator<string> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      yield* walkJson(full);
    } else if (entry.isFile() && entry.name.endsWith(".json")) {
      yield full;
    }
  }
}

export async function loadAllConfigs(root: string = CONFIGS_ROOT): Promise<TabletConfiguration[]> {
  const out: TabletConfiguration[] = [];
  for await (const file of walkJson(root)) {
    try {
      out.push(await loadConfigFile(file));
    } catch {
      continue;
    }
  }
  return out;
}

export interface ConfigMatch {
  config: TabletConfiguration;
  identifier: DigitizerIdentifier;
}

export class ConfigIndex {
  private byVidPid = new Map<string, ConfigMatch[]>();

  constructor(configs: Iterable<TabletConfiguration>) {
    for (const cfg of configs) {
      for (const ident of cfg.digitizerIdentifiers) {
        const key = `${ident.vendorId}:${ident.productId}`;
        const list = this.byVidPid.get(key) ?? [];
        list.push({ config: cfg, identifier: ident });
        this.byVidPid.set(key, list);
      }
    }
  }

  static async fromVendored(): Promise<ConfigIndex> {
    return new ConfigIndex(await loadAllConfigs());
  }

  find(vendorId: number, productId: number,
       inputReportLength: number | null = null): ConfigMatch[] {
    const candidates = [...(this.byVidPid.get(`${vendorId}:${productId}`) ?? [])];
    if (inputReportLength !== null) {
      const narrowed = candidates.filter((m) =>
        m.identifier.inputReportLength === null ||
        m.identifier.inputReportLength === inputReportLength);
      if (narrowed.length > 0) return narrowed;
    }
    return candidates;
  }

  allVidPidPairs(): Array<[number, number]> {
    return [...this.byVidPid.keys()]
      .map((k) => k.split(":").map(Number) as [number, number])
      .sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  }
}
