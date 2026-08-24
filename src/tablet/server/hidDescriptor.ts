/**
 * Minimal HID report-descriptor parser.
 *
 * The standard digitizer interface on most tablets uses a coordinate range
 * that differs from the vendor interface OTD configs are calibrated for.
 * We parse the descriptor returned by the HID device handle to read the
 * actual Logical Maximum for X, Y, and Tip Pressure so the normalization
 * layer can use the right denominators.
 */

export const USAGE_PAGE_GENERIC_DESKTOP = 0x01;
export const USAGE_PAGE_DIGITIZER = 0x0D;
export const USAGE_X = 0x30;
export const USAGE_Y = 0x31;
export const USAGE_TIP_PRESSURE = 0x30; // under the Digitizer page

export interface PenRanges {
  xMax: number | null;
  yMax: number | null;
  pressureMax: number | null;
}

const SIZE_BYTES: Record<number, number> = { 0: 0, 1: 1, 2: 2, 3: 4 };

function readUnsigned(desc: Uint8Array, offset: number, size: number): number {
  let v = 0;
  for (let i = 0; i < size; i++) v |= desc[offset + i] << (i * 8);
  return v >>> 0;
}

function readSigned(desc: Uint8Array, offset: number, size: number): number {
  if (size === 0) return 0;
  let v = 0;
  for (let i = 0; i < size; i++) v |= desc[offset + i] << (i * 8);
  const bits = size * 8;
  const signBit = 1 << (bits - 1);
  if ((v & signBit) !== 0) v -= 1 << bits;
  return v;
}

/**
 * Walk a HID report descriptor; return ranges per Report ID.
 *
 * Implements just enough of the HID 1.11 item-stream format to extract
 * Global Logical Maximum values bound to X, Y and Tip Pressure usages.
 * Unknown items are skipped.
 */
export function parseDescriptor(desc: Uint8Array): Map<number, PenRanges> {
  const out = new Map<number, PenRanges>();
  let usagePage = 0;
  let logicalMax = 0;
  let reportId = 0;
  let usages: Array<[number, number]> = [];

  let i = 0;
  const n = desc.length;
  while (i < n) {
    const prefix = desc[i];
    i += 1;
    if (prefix === 0xFE) {
      // Long items are rare in HID descriptors; skip safely.
      if (i >= n) break;
      const longSize = desc[i];
      i += 2 + longSize;
      continue;
    }

    const size = SIZE_BYTES[prefix & 0x03];
    const itemType = (prefix >> 2) & 0x03;
    const itemTag = (prefix >> 4) & 0x0F;

    if (i + size > n) break;
    const udata = readUnsigned(desc, i, size);
    const sdata = readSigned(desc, i, size);
    i += size;

    if (itemType === 1) { // Global
      if (itemTag === 0x0) usagePage = udata;
      else if (itemTag === 0x2) logicalMax = sdata;
      else if (itemTag === 0x8) reportId = udata;
    } else if (itemType === 2) { // Local
      if (itemTag === 0x0) {
        let page = usagePage;
        let usage = udata;
        // 16-bit usage may carry an inline page in the high byte.
        if (size === 4) {
          page = (udata >>> 16) & 0xFFFF;
          usage = udata & 0xFFFF;
        }
        usages.push([page, usage]);
      }
    } else if (itemType === 0) { // Main
      if (itemTag === 0x8) { // Input
        let ranges = out.get(reportId);
        if (!ranges) {
          ranges = { xMax: null, yMax: null, pressureMax: null };
          out.set(reportId, ranges);
        }
        for (const [page, usage] of usages) {
          if (page === USAGE_PAGE_GENERIC_DESKTOP && usage === USAGE_X) {
            if (ranges.xMax === null) ranges.xMax = logicalMax;
          } else if (page === USAGE_PAGE_GENERIC_DESKTOP && usage === USAGE_Y) {
            if (ranges.yMax === null) ranges.yMax = logicalMax;
          } else if (page === USAGE_PAGE_DIGITIZER && usage === USAGE_TIP_PRESSURE) {
            if (ranges.pressureMax === null) ranges.pressureMax = logicalMax;
          }
        }
      }
      // All Main items clear Local state per HID 1.11 §6.2.2.8.
      usages = [];
    }
  }

  return out;
}

/** Return the first Report ID's ranges that has both X and Y maxes set. */
export function pickPenRanges(descriptor: Uint8Array): PenRanges | null {
  const parsed = parseDescriptor(descriptor);
  const ids = [...parsed.keys()].sort((a, b) => a - b);
  for (const id of ids) {
    const r = parsed.get(id)!;
    if (r.xMax && r.yMax) return r;
  }
  return null;
}
