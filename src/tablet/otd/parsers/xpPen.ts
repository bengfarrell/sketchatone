/** XP-Pen vendor-specific report parsers. */

import {
  OutOfRangeReport,
  TabletReport,
  Tuple2,
  bit,
  s8,
  u16le,
} from "../reports.js";
import { ParsedReport, ReportParser } from "./generic.js";

export class XPPenTabletReport {
  readonly kind = "XPPenTabletReport" as const;
  raw: Uint8Array;
  position: Tuple2 = [0, 0];
  pressure = 0;
  tilt: Tuple2 = [0, 0];
  penButtons: boolean[] = [];
  eraser = false;

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): XPPenTabletReport {
    const r = new XPPenTabletReport(data);
    r.position = [u16le(data, 2), u16le(data, 4)];
    r.pressure = u16le(data, 6);
    r.tilt = [s8(data[8]), s8(data[9])];
    r.penButtons = [bit(data[1], 1), bit(data[1], 2)];
    r.eraser = bit(data[1], 3);
    return r;
  }
}

/**
 * 24-bit X/Y position assembled from low ushort + high byte from tilt slots.
 */
export class XPPenTabletOverflowReport {
  readonly kind = "XPPenTabletOverflowReport" as const;
  raw: Uint8Array;
  position: Tuple2 = [0, 0];
  pressure = 0;
  tilt: Tuple2 = [0, 0];
  penButtons: boolean[] = [];
  eraser = false;

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): XPPenTabletOverflowReport {
    const r = new XPPenTabletOverflowReport(data);
    const x = u16le(data, 2) | (data[10] << 16);
    const y = u16le(data, 4) | (data[11] << 16);
    r.position = [x, y];
    r.pressure = u16le(data, 6);
    r.tilt = [s8(data[8]), s8(data[9])];
    r.penButtons = [bit(data[1], 1), bit(data[1], 2)];
    r.eraser = bit(data[1], 3);
    return r;
  }
}

export class XPPenAuxReport {
  readonly kind = "XPPenAuxReport" as const;
  raw: Uint8Array;
  auxButtons: boolean[] = [];
  analogDeltas: number[] = [];

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array, auxIndex = 2, wheelIndex = 7): XPPenAuxReport {
    const r = new XPPenAuxReport(data);
    const buttons: boolean[] = [];
    for (let i = 0; i < 8; i++) buttons.push(bit(data[auxIndex], i));
    for (let i = 0; i < 8; i++) buttons.push(bit(data[auxIndex + 1], i));
    for (let i = 0; i < 4; i++) buttons.push(bit(data[auxIndex + 2], i));
    r.auxButtons = buttons;
    const w = data[wheelIndex];
    r.analogDeltas = [
      bit(w, 0) ? 1 : bit(w, 1) ? -1 : 0,
      bit(w, 4) ? 1 : bit(w, 5) ? -1 : 0,
    ];
    return r;
  }
}

export class XPPenReportParser implements ReportParser {
  parse(data: Uint8Array): ParsedReport {
    if (data[1] === 0xC0) return new OutOfRangeReport(data);
    if (bit(data[1], 4)) return XPPenAuxReport.parse(data);
    if (data.length >= 12) return XPPenTabletOverflowReport.parse(data);
    if (data.length >= 10) return XPPenTabletReport.parse(data);
    return TabletReport.parse(data);
  }
}
