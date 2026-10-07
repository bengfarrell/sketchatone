#!/usr/bin/env node
/** Command-line entry point: `sketchatone-tablet-server`. */

import { Command, Option } from "commander";

import { ConfigIndex } from "./otd/configLoader.js";
import { knownParsers } from "./otd/parsers/index.js";
import {
  DiscoveredDevice,
  discover,
  isStandardDigitizer,
  pickAuxInterfaces,
  pickDigitizerInterface,
} from "./server/hidDevice.js";
import { TabletService } from "./server/websocketServer.js";

function parseHex(value: string): number {
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const h = parseInt(value, 16);
  if (Number.isNaN(h)) throw new Error(`invalid number: ${value}`);
  return h;
}

function listDevices(devices: DiscoveredDevice[]): void {
  if (devices.length === 0) {
    console.log("No matching tablets found.");
    return;
  }
  console.log(`Found ${devices.length} matching HID interface(s):`);
  for (const d of devices) {
    const cfg = d.match.config;
    const ident = d.match.identifier;
    const parser = ident.reportParser.split(".").pop() ?? ident.reportParser;
    const hex = (n: number) => `0x${n.toString(16).padStart(4, "0")}`;
    console.log(
      `  - ${cfg.name}  vid=${hex(d.vendorId)} pid=${hex(d.productId)}  ` +
      `interface=${d.interfaceNumber}  usage_page=${hex(d.usagePage)}  ` +
      `usage=${hex(d.usage)}  parser=${parser}  path=${d.path}`,
    );
  }
}

function selectDevice(devices: DiscoveredDevice[],
                      preferVid: number | undefined,
                      preferPid: number | undefined): DiscoveredDevice | null {
  let candidates = devices;
  if (preferVid !== undefined) candidates = candidates.filter((d) => d.vendorId === preferVid);
  if (preferPid !== undefined) candidates = candidates.filter((d) => d.productId === preferPid);
  return pickDigitizerInterface(candidates);
}

async function serve(service: TabletService): Promise<void> {
  const shutdown = () => {
    console.log("Shutdown requested");
    service.requestStop();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  await service.start();
}

export async function main(argv: string[] = process.argv): Promise<number> {
  const program = new Command()
    .name("sketchatone-tablet-server")
    .description("Stream tablet events over WebSocket using OpenTabletDriver configs.")
    .option("--port <port>", "WebSocket port", (v) => Number(v), 8765)
    .option("--host <host>", "WebSocket bind address", "0.0.0.0")
    .option("--vid <vid>", "Force a specific USB vendor ID (e.g. 0x256c)", parseHex)
    .option("--pid <pid>", "Force a specific USB product ID", parseHex)
    .option("--list", "List matching connected devices and exit", false)
    .option("--list-parsers", "List parser implementations and exit", false)
    .option("--no-aux", "Don't open auxiliary (express-key) HID interfaces")
    .addOption(new Option("-v, --verbose", "Enable debug logging").default(false))
    .parse(argv);

  const opts = program.opts<{
    port: number; host: string; vid?: number; pid?: number;
    list: boolean; listParsers: boolean; aux: boolean; verbose: boolean;
  }>();

  if (opts.listParsers) {
    for (const name of knownParsers()) console.log(name);
    return 0;
  }

  const index = await ConfigIndex.fromVendored();
  const devices = discover(index);

  if (opts.list) { listDevices(devices); return 0; }

  const device = selectDevice(devices, opts.vid, opts.pid);
  if (!device) {
    console.error(
      "No supported tablet detected. Try --list to see matches, " +
      "or --vid/--pid to force one.",
    );
    return 1;
  }

  const parserName = device.match.identifier.reportParser;
  if (!knownParsers().includes(parserName) && !isStandardDigitizer(device)) {
    console.error(
      `Detected ${device.match.config.name} but parser '${parserName}' is not yet ported.`,
    );
    return 2;
  }

  const sameDevice = devices.filter((d) =>
    d.vendorId === device.vendorId && d.productId === device.productId);
  const auxDevices = opts.aux ? pickAuxInterfaces(sameDevice) : [];
  if (auxDevices.length > 0) {
    console.log(`Found ${auxDevices.length} aux HID interface(s) for ${device.match.config.name}`);
  }

  console.log(`Serving ${device.match.config.name} on ws://${opts.host}:${opts.port}`);
  const service = new TabletService({
    device, auxDevices, port: opts.port, host: opts.host,
  });
  await serve(service);
  return 0;
}

const invoked = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invoked) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
