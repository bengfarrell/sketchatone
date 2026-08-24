/** UCLogic-family report parsers (used by Huion / Gaomon / etc.). */

import { TiltTabletReport, bit } from "../reports.js";
import { ParsedReport, ReportParser } from "./generic.js";

/**
 * Port of OpenTabletDriver.Configurations.Parsers.UCLogic.UCLogicAuxReport.
 *
 * Maps 20 button bits across data[4]..data[6] (bits 0-3 of data[6]).
 */
export class UCLogicAuxReport {
  readonly kind = "UCLogicAuxReport" as const;
  raw: Uint8Array;
  auxButtons: boolean[] = [];

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): UCLogicAuxReport {
    const r = new UCLogicAuxReport(data);
    const buttons: boolean[] = [];
    for (let i = 0; i < 8; i++) buttons.push(bit(data[4], i));
    for (let i = 0; i < 8; i++) buttons.push(bit(data[5], i));
    for (let i = 0; i < 4; i++) buttons.push(bit(data[6], i));
    r.auxButtons = buttons;
    return r;
  }
}

export class UCLogicTiltReportParser implements ReportParser {
  parse(data: Uint8Array): ParsedReport {
    if (bit(data[1], 6)) return UCLogicAuxReport.parse(data);
    return TiltTabletReport.parse(data, false, true);
  }
}
