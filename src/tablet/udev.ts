#!/usr/bin/env node
/**
 * Generate Linux udev rules so the daemon can read tablet HID nodes without root.
 *
 * This is a Node port of OpenTabletDriver's `generate-rules.sh`. It walks the
 * vendored configurations, dedupes by (VendorID, ProductID), and prints rules
 * that:
 *
 * * tag matching hidraw / usb nodes with `uaccess` (gives logged-in users read
 *   access via systemd-logind),
 * * tell libinput to ignore devices that set the `libinputoverride` attribute,
 *   so the tablet's pointer events don't move the desktop cursor.
 *
 * Usage:
 *     npx tsx src/udev.ts > 70-sketchatone.rules
 *     sudo cp 70-sketchatone.rules /etc/udev/rules.d/
 *     sudo udevadm control --reload && sudo udevadm trigger
 */

import { TabletConfiguration, loadAllConfigs } from "./otd/configLoader.js";

const HEADER = [
  "# sketchatone udev rules (derived from OpenTabletDriver configurations)",
  "# https://github.com/OpenTabletDriver/OpenTabletDriver",
  "",
];

interface Bucket { names: Set<string>; libinput: boolean; }

function groupByVidPid(configs: Iterable<TabletConfiguration>) {
  const buckets = new Map<string, Bucket>();
  for (const cfg of configs) {
    for (const ident of cfg.digitizerIdentifiers) {
      const key = `${ident.vendorId}:${ident.productId}`;
      const entry = buckets.get(key) ?? { names: new Set<string>(), libinput: false };
      entry.names.add(cfg.name);
      if (cfg.libinputOverride) entry.libinput = true;
      buckets.set(key, entry);
    }
  }
  const out: Array<[number, number, string[], boolean]> = [];
  for (const [key, entry] of buckets) {
    const [vid, pid] = key.split(":").map(Number);
    out.push([vid, pid, [...entry.names].sort(), entry.libinput]);
  }
  out.sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  return out;
}

export function generateRules(configs: Iterable<TabletConfiguration>): string[] {
  const lines = [...HEADER];
  for (const [vid, pid, names, libinput] of groupByVidPid(configs)) {
    const vidH = vid.toString(16).padStart(4, "0");
    const pidH = pid.toString(16).padStart(4, "0");
    for (const name of names) lines.push(`# ${name}`);
    lines.push(
      `KERNEL=="hidraw*", ATTRS{idVendor}=="${vidH}", ` +
      `ATTRS{idProduct}=="${pidH}", TAG+="uaccess", TAG+="udev-acl"`,
    );
    lines.push(
      `SUBSYSTEM=="usb", ATTRS{idVendor}=="${vidH}", ` +
      `ATTRS{idProduct}=="${pidH}", TAG+="uaccess", TAG+="udev-acl"`,
    );
    if (libinput) {
      lines.push(
        `SUBSYSTEM=="input", ATTRS{idVendor}=="${vidH}", ` +
        `ATTRS{idProduct}=="${pidH}", ENV{LIBINPUT_IGNORE_DEVICE}="1"`,
      );
    }
    lines.push("");
  }
  return lines;
}

export async function main(): Promise<number> {
  const configs = await loadAllConfigs();
  for (const line of generateRules(configs)) console.log(line);
  return 0;
}

const invoked = process.argv[1] && import.meta.url === `file://${process.argv[1]}`;
if (invoked) {
  main().then((code) => process.exit(code)).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
