/** HID enumeration and exclusive-access device reading. */

import HID from "node-hid";

import { ConfigIndex, ConfigMatch } from "../otd/configLoader.js";

/**
 * Among configs that share a `{VID, PID}` (common with UCLogic-based
 * tablets rebranded across Huion, Gaomon, Artisul, etc.), pick the one
 * that best matches the device's own USB descriptor strings. Falls back
 * to the first candidate when no tie-breaker fires.
 */
export function pickBestMatch(
  candidates: ConfigMatch[],
  productString: string,
  manufacturerString: string,
): ConfigMatch {
  if (candidates.length <= 1) return candidates[0];
  const product = productString.toLowerCase();
  const manufacturer = manufacturerString.toLowerCase();
  let best = candidates[0];
  let bestScore = scoreMatch(best, product, manufacturer);
  for (let i = 1; i < candidates.length; i++) {
    const s = scoreMatch(candidates[i], product, manufacturer);
    if (s > bestScore) { best = candidates[i]; bestScore = s; }
  }
  return best;
}

function scoreMatch(match: ConfigMatch, product: string, manufacturer: string): number {
  const cfg = match.config;
  let score = 0;
  if (manufacturer && cfg.manufacturer.toLowerCase() === manufacturer) score += 2;
  if (product && cfg.model && product.includes(cfg.model.toLowerCase())) score += 1;
  return score;
}

export interface DiscoveredDevice {
  vendorId: number;
  productId: number;
  /** Platform-specific HID path returned by node-hid. */
  path: string;
  interfaceNumber: number;
  usagePage: number;
  usage: number;
  productString: string;
  manufacturerString: string;
  serialNumber: string;
  inputReportLength: number | null;
  match: ConfigMatch;
}

function rawEnumerate(): HID.Device[] { return HID.devices(); }

/** Enumerate HID devices and return any that match a vendored OTD config. */
export function discover(index: ConfigIndex): DiscoveredDevice[] {
  const matches: DiscoveredDevice[] = [];
  for (const entry of rawEnumerate()) {
    const vid = entry.vendorId;
    const pid = entry.productId;
    if (vid == null || pid == null) continue;
    const candidates = index.find(vid, pid);
    if (candidates.length === 0) continue;
    const productString = entry.product ?? "";
    const manufacturerString = entry.manufacturer ?? "";
    matches.push({
      vendorId: vid,
      productId: pid,
      path: entry.path ?? "",
      interfaceNumber: entry.interface ?? -1,
      usagePage: entry.usagePage ?? 0,
      usage: entry.usage ?? 0,
      productString,
      manufacturerString,
      serialNumber: entry.serialNumber ?? "",
      inputReportLength: null,
      match: pickBestMatch(candidates, productString, manufacturerString),
    });
  }
  return matches;
}

export const DIGITIZER_USAGE_PAGE = 0x0D;
export const AUX_USAGE_PAGE_GENERIC_DESKTOP = 0x01;
export const AUX_USAGE_PAGE_CONSUMER = 0x0C;
const AUX_USAGE_PAGES = new Set([AUX_USAGE_PAGE_GENERIC_DESKTOP, AUX_USAGE_PAGE_CONSUMER]);

/** True if the interface is the standard HID Digitizer (UsagePage 0x0D). */
export function isStandardDigitizer(device: DiscoveredDevice): boolean {
  return device.usagePage === DIGITIZER_USAGE_PAGE;
}

/**
 * Return the non-pen HID interfaces that expose the tablet's express keys.
 *
 * Tablets that want the OS to recognize their hardware buttons surface
 * them through standard Keyboard (usage page 0x01) or Consumer Control
 * (usage page 0x0C) collections on a separate interface from the
 * digitizer. We open each unique path so we can forward raw scan codes
 * to clients.
 */
export function pickAuxInterfaces(devices: DiscoveredDevice[]): DiscoveredDevice[] {
  const penIfaces = new Set<number>();
  for (const d of devices) if (isStandardDigitizer(d)) penIfaces.add(d.interfaceNumber);
  const seenPaths = new Set<string>();
  const out: DiscoveredDevice[] = [];
  for (const d of devices) {
    if (isStandardDigitizer(d)) continue;
    if (penIfaces.has(d.interfaceNumber)) continue;
    if (!AUX_USAGE_PAGES.has(d.usagePage)) continue;
    if (seenPaths.has(d.path)) continue;
    seenPaths.add(d.path);
    out.push(d);
  }
  return out;
}

/**
 * From candidates for a single tablet, pick the digitizer (pen) interface.
 *
 * Preference order:
 *   1. The standard HID Digitizer interface (UsagePage 0x0D). Actively
 *      reading it gives us the OS-compatibility reports our generic
 *      parser understands and (on macOS) suppresses the system cursor
 *      without requiring any vendor-specific init sequence.
 *   2. Anything else, falling back to the highest usagePage (vendor
 *      pages 0xFF00+ require a parser-specific init we may not be able
 *      to perform on every OS).
 */
export function pickDigitizerInterface(
  devices: DiscoveredDevice[],
): DiscoveredDevice | null {
  if (devices.length === 0) return null;
  const digitizers = devices.filter(isStandardDigitizer);
  const pool = digitizers.length > 0 ? digitizers : devices;
  return pool.reduce((best, d) => {
    if (d.usagePage !== best.usagePage) return d.usagePage > best.usagePage ? d : best;
    return d.interfaceNumber > best.interfaceNumber ? d : best;
  });
}

export type ReportCallback = (data: Uint8Array) => void;
export type DisconnectCallback = () => void;

/** Reads HID input reports asynchronously via node-hid's internal poll thread. */
export class HidReader {
  private dev: HID.HID | null = null;
  private onReport: ReportCallback | null = null;
  private onDisconnect: DisconnectCallback | null = null;
  private lastLogKey: string | null = null;
  private stopped = false;

  constructor(public device: DiscoveredDevice, private log = console) {}

  open(opts: { runInit?: boolean } = {}): void {
    const runInit = opts.runInit ?? true;
    const d = new HID.HID(this.device.path);
    this.dev = d;
    this.log.info?.(
      `Opened HID device ${this.device.productString} ` +
      `(VID=${this.device.vendorId.toString(16).padStart(4, "0")} ` +
      `PID=${this.device.productId.toString(16).padStart(4, "0")} ` +
      `interface=${this.device.interfaceNumber})`,
    );
    if (runInit) this.runInitSequence();
  }

  private runInitSequence(): void {
    const dev = this.dev;
    if (!dev) return;
    const ident = this.device.match.identifier;
    // String descriptor reads via hidapi: many vendor tablets need this
    // as the magic mode-switch into vendor-report mode. node-hid doesn't
    // expose get_indexed_string, so we attempt feature/output reports only.
    // A libusb fallback (pyusb-equivalent) is not yet ported.
    for (const report of ident.featureInitReports) {
      try { dev.sendFeatureReport(Array.from(report)); }
      catch (err) { this.log.warn?.(`FeatureInitReport failed: ${(err as Error).message}`); }
    }
    for (const report of ident.outputInitReports) {
      try { dev.write(Array.from(report)); }
      catch (err) { this.log.warn?.(`OutputInitReport failed: ${(err as Error).message}`); }
    }
  }

  /** Return the raw HID report descriptor, or null if unsupported. */
  getReportDescriptor(): Uint8Array | null {
    if (!this.dev) return null;
    try {
      const data = (this.dev as any).getReportDescriptor?.();
      if (!data || data.length === 0) return null;
      return data instanceof Uint8Array ? data : new Uint8Array(data);
    } catch { return null; }
  }

  start(onReport: ReportCallback, onDisconnect: DisconnectCallback | null = null): void {
    if (!this.dev) throw new Error("Device not opened");
    this.onReport = onReport;
    this.onDisconnect = onDisconnect;
    this.stopped = false;
    this.dev.on("data", (data: Buffer) => this.handleReport(data));
    this.dev.on("error", (err: Error) => {
      if (this.stopped) return;
      this.log.warn?.(`HID read failed; signalling disconnect: ${err.message}`);
      this.onDisconnect?.();
    });
  }

  private handleReport(buf: Buffer): void {
    // Collapse high-rate streams: only log when the report id or status
    // byte changes, since per-sample X/Y/pressure noise drowns out the
    // transitions we care about (button presses, in-range/out-of-range).
    const data = new Uint8Array(buf);
    if (this.log.debug) {
      const key = (data.length >= 2 ? `${data[0]},${data[1]}` : `${data[0] ?? ""}`);
      if (key !== this.lastLogKey) {
        this.log.debug(`report: ${buf.toString("hex")}`);
        this.lastLogKey = key;
      }
    }
    try { this.onReport?.(data); }
    catch (err) { this.log.error?.(`on_report callback raised: ${(err as Error).message}`); }
  }

  stop(): void {
    this.stopped = true;
    if (this.dev) {
      try { this.dev.close(); } catch { /* noop */ }
      this.dev = null;
    }
  }
}
