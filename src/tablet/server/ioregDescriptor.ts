/** macOS fallback: read HID report descriptors out of the IOKit registry.
 *
 * On macOS, IOHIDFamily claims every HID interface before libusb gets a
 * chance, so the libusb GET_DESCRIPTOR path in usbDescriptor.ts fails.
 * However, the kernel already parsed the descriptor at enumeration time
 * and stores the raw bytes under the "ReportDescriptor" property of each
 * IOHIDDevice in the I/O registry, so we can shell out to `ioreg` and
 * recover them without needing any device access at all.
 *
 * We match on VendorID + ProductID + PrimaryUsagePage so callers can
 * pick the digitizer interface (PrimaryUsagePage 0x0D) even when the
 * same VID/PID exposes multiple HID collections (keyboard, vendor,
 * digitizer) on separate USB interfaces.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Per-device-block summary of properties we care about. */
interface IoregHidDevice {
  vendorId: number | null;
  productId: number | null;
  primaryUsagePage: number | null;
  primaryUsage: number | null;
  descriptor: Uint8Array | null;
}

/**
 * Return the raw HID report descriptor for the matching interface, or null.
 *
 * Pass the device's primary usage page (e.g. 0x0D for the standard
 * digitizer interface). The USB interface number isn't exposed on
 * IOHIDDevice, but the {VID, PID, primaryUsagePage} triple is unique
 * for every tablet we've seen.
 */
export async function getReportDescriptorViaIoreg(
  vendorId: number,
  productId: number,
  primaryUsagePage: number,
): Promise<Uint8Array | null> {
  if (process.platform !== "darwin") return null;
  let output: string;
  try {
    const { stdout } = await execFileAsync(
      "ioreg",
      ["-l", "-w", "0", "-r", "-c", "IOHIDDevice"],
      { maxBuffer: 32 * 1024 * 1024, timeout: 5_000 },
    );
    output = stdout;
  } catch {
    return null;
  }
  for (const dev of parseIoregOutput(output)) {
    if (dev.vendorId !== vendorId) continue;
    if (dev.productId !== productId) continue;
    if (dev.primaryUsagePage !== primaryUsagePage) continue;
    if (dev.descriptor && dev.descriptor.length > 0) return dev.descriptor;
  }
  return null;
}

/**
 * Split ioreg output into per-device chunks and extract the properties we
 * care about. Each `+-o` line begins a new node; nested children appear
 * as subsequent `+-o` lines with deeper indentation. Property lines look
 * like `|   "Name" = value` at varying indent levels.
 */
export function parseIoregOutput(output: string): IoregHidDevice[] {
  const devices: IoregHidDevice[] = [];
  const lines = output.split("\n");
  let current: IoregHidDevice | null = null;
  for (const line of lines) {
    if (/\+-o\s+\S+\s+<class\s+/.test(line)) {
      if (current) devices.push(current);
      current = {
        vendorId: null, productId: null,
        primaryUsagePage: null, primaryUsage: null,
        descriptor: null,
      };
      continue;
    }
    if (!current) continue;
    const m = /"([A-Za-z]+)"\s*=\s*(.+?)\s*$/.exec(line);
    if (!m) continue;
    const [, name, raw] = m;
    switch (name) {
      case "VendorID":
        if (current.vendorId === null) current.vendorId = parseDecimal(raw);
        break;
      case "ProductID":
        if (current.productId === null) current.productId = parseDecimal(raw);
        break;
      case "PrimaryUsagePage":
        if (current.primaryUsagePage === null) current.primaryUsagePage = parseDecimal(raw);
        break;
      case "PrimaryUsage":
        if (current.primaryUsage === null) current.primaryUsage = parseDecimal(raw);
        break;
      case "ReportDescriptor":
        if (current.descriptor === null) current.descriptor = parseHexBlob(raw);
        break;
    }
  }
  if (current) devices.push(current);
  return devices;
}

function parseDecimal(raw: string): number | null {
  const m = /^-?\d+/.exec(raw);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

function parseHexBlob(raw: string): Uint8Array | null {
  // ioreg renders data as `<deadbeef...>`; with -w 0 the whole blob is
  // on one line but we still tolerate intra-blob spaces just in case.
  const m = /<([0-9a-fA-F\t ]+)>/.exec(raw);
  if (!m) return null;
  const hex = m[1].replace(/[\t ]/g, "");
  if (hex.length === 0 || hex.length % 2 !== 0) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(hex.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) return null;
    out[i] = byte;
  }
  return out;
}
