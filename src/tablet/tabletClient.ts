/**
 * High-level tablet client that composes discovery, HID reading, parsing,
 * and event adaptation into a single unit that CLIs and services can drive
 * with a couple of callbacks.
 *
 * This is the sketchatone-side analogue of the vendored `TabletService` in
 * `server/websocketServer.ts`, but without any transport concerns: the
 * consumer decides how to fan events out (websocket, bus, stdout, etc.).
 */

import { ConfigIndex, TabletConfiguration } from "./otd/configLoader.js";
import {
  ReportParser,
  StandardDigitizerReportParser,
  getParser,
} from "./otd/parsers/index.js";
import { parseAuxReport } from "./server/auxReport.js";
import { EventAdapter, TabletEvent } from "./server/eventAdapter.js";
import { pickPenRanges } from "./server/hidDescriptor.js";
import {
  DiscoveredDevice,
  HidReader,
  discover,
  isStandardDigitizer,
  pickAuxInterfaces,
  pickDigitizerInterface,
} from "./server/hidDevice.js";
import { getReportDescriptorViaIoreg } from "./server/ioregDescriptor.js";
import { getReportDescriptorViaUsb } from "./server/usbDescriptor.js";

export interface DeviceCapabilities {
  name: string;
  manufacturer: string;
  model: string;
  maxX: number;
  maxY: number;
  maxPressure: number;
  penButtonCount: number;
  auxButtonCount: number;
}

export interface DiscoverOptions {
  vendorId?: number;
  productId?: number;
  useAux?: boolean;
  configIndex?: ConfigIndex;
  log?: Pick<Console, "info" | "warn" | "error" | "debug">;
}

export interface StartHandlers {
  onEvent: (event: TabletEvent) => void;
  onDisconnect?: () => void;
}

/** Composes an OTD-matched HID device with parser + adapter + aux readers. */
export class TabletClient {
  readonly device: DiscoveredDevice;
  readonly auxDevices: DiscoveredDevice[];
  readonly config: TabletConfiguration;
  readonly adapter: EventAdapter;
  readonly reader: HidReader;
  private readonly parser: ReportParser;
  private readonly useStandardDigitizer: boolean;
  private readonly auxReaders: HidReader[] = [];
  private readonly log: NonNullable<DiscoverOptions["log"]>;
  private handlers: StartHandlers | null = null;
  private started = false;

  constructor(opts: {
    device: DiscoveredDevice;
    auxDevices?: DiscoveredDevice[];
    log?: DiscoverOptions["log"];
  }) {
    this.device = opts.device;
    this.auxDevices = opts.auxDevices ?? [];
    this.log = opts.log ?? console;
    this.config = this.device.match.config;
    this.useStandardDigitizer = isStandardDigitizer(this.device);
    if (this.useStandardDigitizer) {
      this.log.info?.(`Using standard HID digitizer parser for ${this.config.name}`);
      this.parser = new StandardDigitizerReportParser();
    } else {
      this.parser = getParser(this.device.match.identifier.reportParser);
    }
    this.adapter = new EventAdapter(this.config);
    this.reader = new HidReader(this.device, this.log as Console);
  }

  /** Enumerate connected HID devices and return a client for the best match, or null. */
  static async discover(opts: DiscoverOptions = {}): Promise<TabletClient | null> {
    const index = opts.configIndex ?? await ConfigIndex.fromVendored();
    let devices = discover(index);
    if (opts.vendorId !== undefined) devices = devices.filter((d) => d.vendorId === opts.vendorId);
    if (opts.productId !== undefined) devices = devices.filter((d) => d.productId === opts.productId);
    const device = pickDigitizerInterface(devices);
    if (!device) return null;
    const siblings = devices.filter(
      (d) => d.vendorId === device.vendorId && d.productId === device.productId,
    );
    const auxDevices = (opts.useAux ?? true) ? pickAuxInterfaces(siblings) : [];
    return new TabletClient({ device, auxDevices, log: opts.log });
  }

  get capabilities(): DeviceCapabilities {
    const spec = this.config.specifications;
    return {
      name: this.config.name,
      manufacturer: this.config.manufacturer,
      model: this.config.model,
      maxX: spec.digitizerMaxX,
      maxY: spec.digitizerMaxY,
      maxPressure: spec.penMaxPressure,
      penButtonCount: spec.penButtonCount,
      auxButtonCount: spec.auxButtonCount,
    };
  }

  async start(handlers: StartHandlers): Promise<void> {
    if (this.started) throw new Error("TabletClient already started");
    this.started = true;
    this.handlers = handlers;
    this.reader.open({ runInit: !this.useStandardDigitizer });
    if (this.useStandardDigitizer) await this.applyDescriptorRanges();
    this.reader.start(
      (data) => this.onReport(data),
      () => this.onDisconnect(),
    );
    this.log.info?.(`Reading from ${this.config.name}`);
    this.startAuxReaders();
  }

  stop(): void {
    this.reader.stop();
    for (const r of this.auxReaders) r.stop();
    this.auxReaders.length = 0;
    this.handlers = null;
    this.started = false;
  }

  private async applyDescriptorRanges(): Promise<void> {
    const descriptor = this.reader.getReportDescriptor()
      ?? await getReportDescriptorViaUsb(
        this.device.vendorId,
        this.device.productId,
        this.device.interfaceNumber,
      )
      ?? await getReportDescriptorViaIoreg(
        this.device.vendorId,
        this.device.productId,
        this.device.usagePage,
      );
    if (!descriptor) {
      this.log.warn?.(
        "No HID report descriptor available (node-hid, libusb, and ioreg fallbacks all failed); " +
        "falling back to OTD config ranges, which may not match the standard digitizer interface",
      );
      return;
    }
    const ranges = pickPenRanges(descriptor);
    if (!ranges) {
      this.log.debug?.("No pen X/Y usages found in descriptor; using config ranges");
      return;
    }
    this.log.info?.(
      `Descriptor pen ranges: xMax=${ranges.xMax} yMax=${ranges.yMax} pressureMax=${ranges.pressureMax}`,
    );
    this.adapter.overrideRanges({
      maxX: ranges.xMax ?? undefined,
      maxY: ranges.yMax ?? undefined,
      maxPressure: ranges.pressureMax ?? undefined,
    });
  }

  private startAuxReaders(): void {
    for (const aux of this.auxDevices) {
      const reader = new HidReader(aux, this.log as Console);
      try { reader.open({ runInit: false }); }
      catch (err) {
        this.log.warn?.(
          `Could not open aux interface ${aux.path} ` +
          `(usagePage=0x${aux.usagePage.toString(16).padStart(4, "0")}): ${(err as Error).message}. ` +
          "On macOS the keyboard-class aux interface requires root; " +
          "rerun with sudo to capture express keys.",
        );
        continue;
      }
      reader.start(
        (data) => this.onAuxReport(aux, data),
        null,
      );
      this.auxReaders.push(reader);
      this.log.info?.(
        `Reading aux interface ${aux.interfaceNumber} ` +
        `(usagePage=0x${aux.usagePage.toString(16).padStart(4, "0")}) for ${this.config.name}`,
      );
    }
  }

  private onAuxReport(aux: DiscoveredDevice, data: Uint8Array): void {
    const { reportId, codes } = parseAuxReport(data);
    if (!this.adapter.updateAuxCodes(aux.path, reportId, codes)) return;
    this.handlers?.onEvent(this.adapter.emptyEvent());
  }

  private onReport(data: Uint8Array): void {
    let report;
    try { report = this.parser.parse(data); }
    catch { return; }
    if (!report) return;
    const event = this.adapter.adapt(report);
    if (!event) return;
    this.handlers?.onEvent(event);
  }

  private onDisconnect(): void {
    this.handlers?.onDisconnect?.();
  }
}

/**
 * Poll for a discoverable device until one appears.
 *
 * Returns immediately if a device is already connected. Otherwise sleeps
 * `intervalMs` between attempts and calls `onWaiting` once (on first miss)
 * so callers can log a message without spamming the console.
 */
export async function waitForDevice(
  opts: DiscoverOptions & { intervalMs: number; onWaiting?: () => void },
): Promise<TabletClient> {
  const { intervalMs, onWaiting, ...discoverOpts } = opts;
  let notified = false;
  for (;;) {
    const client = await TabletClient.discover(discoverOpts);
    if (client) return client;
    if (!notified) { onWaiting?.(); notified = true; }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
