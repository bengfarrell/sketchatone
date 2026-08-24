/**
 * Report parser registry.
 *
 * OTD configurations identify their parser via a fully-qualified C# class name
 * (e.g. `OpenTabletDriver.Plugin.Tablet.TabletReportParser`). The registry
 * maps those names to the TypeScript implementations in this package.
 */

import {
  AuxReportParser,
  ReportParser,
  TabletReportParser,
  TiltTabletReportParser,
} from "./generic.js";
import { UCLogicTiltReportParser } from "./uclogic.js";
import { HuionTiltReportParser, InspiroyReportParser } from "./huion.js";
import { XPPenReportParser } from "./xpPen.js";

export {
  AuxReportParser,
  StandardDigitizerReportParser,
  TabletReportParser,
  TiltTabletReportParser,
} from "./generic.js";
export { UCLogicAuxReport, UCLogicTiltReportParser } from "./uclogic.js";
export {
  HuionTiltReportParser,
  HuionWheelReport,
  InspiroyAuxReport,
  InspiroyRelWheelReport,
  InspiroyReportParser,
} from "./huion.js";
export {
  XPPenAuxReport,
  XPPenReportParser,
  XPPenTabletOverflowReport,
  XPPenTabletReport,
} from "./xpPen.js";
export type { ParsedReport, ReportParser } from "./generic.js";

type ParserFactory = () => ReportParser;

const REGISTRY: Record<string, ParserFactory> = {
  "OpenTabletDriver.Plugin.Tablet.TabletReportParser": () => new TabletReportParser(),
  "OpenTabletDriver.Plugin.Tablet.TiltTabletReportParser": () => new TiltTabletReportParser(),
  "OpenTabletDriver.Plugin.Tablet.AuxReportParser": () => new AuxReportParser(),
  "OpenTabletDriver.Configurations.Parsers.UCLogic.UCLogicTiltReportParser": () => new UCLogicTiltReportParser(),
  "OpenTabletDriver.Configurations.Parsers.Huion.HuionTiltReportParser": () => new HuionTiltReportParser(),
  "OpenTabletDriver.Configurations.Parsers.Huion.InspiroyReportParser": () => new InspiroyReportParser(),
  "OpenTabletDriver.Configurations.Parsers.XP_Pen.XP_PenReportParser": () => new XPPenReportParser(),
};

export class UnknownParserError extends Error {
  constructor(name: string) {
    super(`No TypeScript implementation registered for OTD parser '${name}'.`);
    this.name = "UnknownParserError";
  }
}

/** Instantiate a parser by its fully-qualified OTD class name. */
export function getParser(name: string): ReportParser {
  const factory = REGISTRY[name];
  if (!factory) throw new UnknownParserError(name);
  return factory();
}

/** Return the list of OTD parser class names currently implemented. */
export function knownParsers(): string[] {
  return Object.keys(REGISTRY).sort();
}

