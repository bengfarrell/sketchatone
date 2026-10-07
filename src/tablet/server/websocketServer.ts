/** WebSocket server that broadcasts normalized tablet events. */

import { WebSocket, WebSocketServer } from "ws";

import { TabletConfiguration } from "../otd/configLoader.js";
import {
  StandardDigitizerReportParser,
  ReportParser,
  getParser,
} from "../otd/parsers/index.js";
import { parseAuxReport } from "./auxReport.js";
import { EventAdapter, TabletEvent } from "./eventAdapter.js";
import { pickPenRanges } from "./hidDescriptor.js";
import {
  DiscoveredDevice,
  HidReader,
  isStandardDigitizer,
} from "./hidDevice.js";
import { getReportDescriptorViaIoreg } from "./ioregDescriptor.js";
import { getReportDescriptorViaUsb } from "./usbDescriptor.js";

export interface TabletServiceOptions {
  device: DiscoveredDevice;
  auxDevices?: DiscoveredDevice[];
  port?: number;
  host?: string;
  log?: Pick<Console, "info" | "warn" | "error" | "debug">;
}

/** Wires HID reader -> parser -> adapter -> websocket broadcast. */
export class TabletService {
  readonly device: DiscoveredDevice;
  readonly auxDevices: DiscoveredDevice[];
  readonly port: number;
  readonly host: string;
  readonly config: TabletConfiguration;
  readonly adapter: EventAdapter;
  readonly reader: HidReader;
  private readonly parser: ReportParser;
  private readonly useStandardDigitizer: boolean;
  private readonly auxReaders: HidReader[] = [];
  private readonly clients = new Set<WebSocket>();
  private wss: WebSocketServer | null = null;
  private readonly log: NonNullable<TabletServiceOptions["log"]>;
  private stopResolve: (() => void) | null = null;

  constructor(opts: TabletServiceOptions) {
    this.device = opts.device;
    this.auxDevices = opts.auxDevices ?? [];
    this.port = opts.port ?? 8765;
    this.host = opts.host ?? "0.0.0.0";
    this.log = opts.log ?? console;
    this.config = this.device.match.config;

    // The vendored OTD parsers expect bytes from the tablet's vendor
    // interface, which usually requires a firmware-specific init that
    // we can't reliably trigger on macOS. When we're attached to the
    // standard digitizer interface instead, swap in a generic parser
    // that understands OS-compatibility reports.
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

  async start(): Promise<void> {
    this.wss = new WebSocketServer({ host: this.host, port: this.port });
    this.wss.on("connection", (ws) => this.handleClient(ws));
    this.log.info?.(`WebSocket listening on ws://${this.host}:${this.port}`);

    this.reader.open({ runInit: !this.useStandardDigitizer });
    if (this.useStandardDigitizer) await this.applyDescriptorRanges();
    this.reader.start(
      (data) => this.onReport(data),
      () => this.onDisconnect(),
    );
    this.log.info?.(`Reading from ${this.config.name}`);

    this.startAuxReaders();

    await new Promise<void>((resolve) => { this.stopResolve = resolve; });
    await this.shutdown();
  }

  requestStop(): void {
    this.stopResolve?.();
    this.stopResolve = null;
  }

  /**
   * Override the adapter's normalization ranges using the device's
   * HID report descriptor. The OTD config's MaxX/MaxY are calibrated
   * for the vendor interface and don't apply to the standard
   * digitizer interface we're reading here.
   *
   * Source order: node-hid (currently never returns anything in 3.x),
   * then a libusb GET_DESCRIPTOR fallback that mirrors what hidapi
   * does internally on Linux, and finally an `ioreg` scrape on macOS
   * where IOHIDFamily holds the interface and refuses libusb claims.
   */
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

  /**
   * Open every aux interface in parallel with the pen reader.
   *
   * Express keys arrive on a separate Keyboard / Consumer Control
   * interface; we forward the raw scan codes so downstream projects
   * can build their own per-device mappings. On macOS opening these
   * keyboard-class interfaces requires root, so the daemon must be
   * launched with `sudo` to capture them.
   */
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
    this.broadcast(this.adapter.emptyEvent());
  }

  private onReport(data: Uint8Array): void {
    let report;
    try { report = this.parser.parse(data); }
    catch { return; }
    if (!report) return;
    const event = this.adapter.adapt(report);
    if (!event) return;
    this.broadcast(event);
  }

  private onDisconnect(): void {
    this.broadcastStatus("disconnected", "Tablet disconnected");
    this.requestStop();
  }

  private handleClient(ws: WebSocket): void {
    this.clients.add(ws);
    this.log.info?.(`Client connected (${this.clients.size} total)`);
    // auxButtonCount comes from the community-maintained OTD config and
    // is not authoritative for any given unit (it can miss mode-switched
    // layouts or just be wrong). Clients should treat it as a hint and
    // discover the real button set from observed `auxCodes` over time.
    ws.send(JSON.stringify({
      type: "connected",
      config: {
        name: this.config.name,
        manufacturer: this.config.manufacturer,
        model: this.config.model,
        maxX: this.config.specifications.digitizerMaxX,
        maxY: this.config.specifications.digitizerMaxY,
        maxPressure: this.config.specifications.penMaxPressure,
        auxButtonCount: this.config.specifications.auxButtonCount,
      },
      mode: "device",
      dataFormat: "translated",
    }));
    ws.on("close", () => {
      this.clients.delete(ws);
      this.log.info?.(`Client disconnected (${this.clients.size} remaining)`);
    });
    ws.on("error", () => this.clients.delete(ws));
  }

  private broadcast(event: TabletEvent): void {
    if (this.clients.size === 0) return;
    const msg = JSON.stringify(event);
    this.sendAll(msg);
  }

  private broadcastStatus(status: string, message: string): void {
    if (this.clients.size === 0) return;
    this.sendAll(JSON.stringify({
      type: "status", status, message, timestamp: Date.now(),
    }));
  }

  private sendAll(msg: string): void {
    for (const client of this.clients) {
      try { client.send(msg); }
      catch { this.clients.delete(client); }
    }
  }

  private async shutdown(): Promise<void> {
    this.reader.stop();
    for (const r of this.auxReaders) r.stop();
    this.auxReaders.length = 0;
    if (this.wss) {
      for (const client of this.clients) {
        try { client.close(); } catch { /* noop */ }
      }
      await new Promise<void>((resolve) => this.wss!.close(() => resolve()));
    }
  }
}
