/** Huion vendor-specific report parsers. */

import {
  DeviceReport,
  OutOfRangeReport,
  TiltTabletReport,
  bit,
} from "../reports.js";
import { ParsedReport, ReportParser } from "./generic.js";
import { UCLogicAuxReport } from "./uclogic.js";

/**
 * Port of OpenTabletDriver.Configurations.Parsers.UCLogic.InspiroyAuxReport.
 *
 * Same layout as UCLogicAuxReport with one bit re-purposed for a wheel button.
 */
export class InspiroyAuxReport {
  readonly kind = "InspiroyAuxReport" as const;
  raw: Uint8Array;
  auxButtons: boolean[] = [];
  wheelButtons: boolean[][] = [];

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): InspiroyAuxReport {
    const r = new InspiroyAuxReport(data);
    const aux: boolean[] = [];
    for (let i = 0; i < 8; i++) aux.push(bit(data[4], i));
    for (const i of [0, 1, 2, 3, 5, 6, 7]) aux.push(bit(data[5], i));
    for (let i = 0; i < 4; i++) aux.push(bit(data[6], i));
    r.auxButtons = aux;
    r.wheelButtons = [[bit(data[5], 4)]];
    return r;
  }
}

export class InspiroyRelWheelReport {
  readonly kind = "InspiroyRelWheelReport" as const;
  constructor(public raw: Uint8Array) {}
}

export class HuionWheelReport {
  readonly kind = "HuionWheelReport" as const;
  constructor(public raw: Uint8Array) {}
}

export class InspiroyReportParser implements ReportParser {
  parse(data: Uint8Array): ParsedReport {
    const b = data[1];
    if (b === 0xE0) return UCLogicAuxReport.parse(data);
    if (b === 0xE3) return UCLogicAuxReport.parse(data);
    if (b === 0xF1) return new InspiroyRelWheelReport(data);
    if (b === 0x00) return new OutOfRangeReport(data);
    if (bit(b, 7)) return TiltTabletReport.parse(data, false, true);
    return new DeviceReport(data);
  }
}

export class HuionTiltReportParser implements ReportParser {
  parse(data: Uint8Array): ParsedReport {
    const b = data[1];
    if (b === 0xE0) return InspiroyAuxReport.parse(data);
    if (b === 0xF0) return new HuionWheelReport(data);
    return TiltTabletReport.parse(data);
  }
}
