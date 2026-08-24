/** Generic report parsers (port of OpenTabletDriver.Plugin.Tablet). */

import {
  AuxReport,
  OutOfRangeReport,
  StandardDigitizerReport,
  TabletReport,
  TiltTabletReport,
} from "../reports.js";

/**
 * Parsers may return generic OTD report objects or vendor-specific ones
 * (defined in sibling modules). All produced reports carry a `kind` string
 * tag so the event adapter can dispatch structurally without a closed union.
 */
export interface ParsedReport {
  readonly kind: string;
  raw: Uint8Array;
}

export interface ReportParser {
  parse(data: Uint8Array): ParsedReport | null;
}

export class TabletReportParser implements ReportParser {
  parse(data: Uint8Array): TabletReport { return TabletReport.parse(data); }
}

export class TiltTabletReportParser implements ReportParser {
  parse(data: Uint8Array): TiltTabletReport { return TiltTabletReport.parse(data); }
}

export class AuxReportParser implements ReportParser {
  parse(data: Uint8Array): AuxReport { return AuxReport.parse(data); }
}

/**
 * Parses standard HID Digitizer pen reports (UsagePage 0x0D).
 *
 * Used when we open the tablet's OS-compatibility digitizer interface
 * instead of its vendor interface (which would require firmware-specific
 * initialization that we can't always perform on macOS).
 *
 * Returns null for packets that don't look like pen reports so the
 * service can quietly ignore button/touch frames muxed onto the same
 * interface.
 */
export class StandardDigitizerReportParser implements ReportParser {
  parse(data: Uint8Array): ParsedReport | null {
    if (data.length < 8) return null;
    const status = data[1];
    // Mirror OTD's InspiroyReportParser dispatch: status==0 is the
    // explicit pen-left-proximity frame; only bit 7 frames are pen
    // samples. Other status bytes (aux/wheel) are ignored here.
    if (status === 0x00) return new OutOfRangeReport(data);
    if ((status & 0x80) === 0) return null;
    return StandardDigitizerReport.parse(data);
  }
}
