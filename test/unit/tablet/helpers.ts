/** Shared fixture builders for the vendored tablet Node test suite. */

import {
  ConfigMatch,
  DigitizerIdentifier,
  TabletConfiguration,
} from "../../../src/tablet/otd/configLoader.js";
import { DiscoveredDevice } from "../../../src/tablet/server/hidDevice.js";

export interface MakeConfigOpts {
  name?: string;
  maxX?: number;
  maxY?: number;
  maxPressure?: number;
  identifiers?: DigitizerIdentifier[];
}

export function makeConfig(opts: MakeConfigOpts = {}): TabletConfiguration {
  const {
    name = "Test Tablet",
    maxX = 1000,
    maxY = 500,
    maxPressure = 8192,
    identifiers = [],
  } = opts;
  return new TabletConfiguration(
    name,
    "/dev/null",
    {
      digitizerWidthMm: 0,
      digitizerHeightMm: 0,
      digitizerMaxX: maxX,
      digitizerMaxY: maxY,
      penMaxPressure: maxPressure,
      penButtonCount: 0,
      auxButtonCount: 0,
    },
    identifiers,
  );
}

export interface MakeIdentifierOpts {
  vendorId?: number;
  productId?: number;
  inputReportLength?: number | null;
  parser?: string;
}

export function makeIdentifier(opts: MakeIdentifierOpts = {}): DigitizerIdentifier {
  return {
    vendorId: opts.vendorId ?? 0x256C,
    productId: opts.productId ?? 0x006E,
    inputReportLength: opts.inputReportLength ?? 12,
    outputReportLength: null,
    reportParser: opts.parser ?? "OpenTabletDriver.Plugin.Tablet.TabletReportParser",
    deviceStrings: {},
    initializationStrings: [],
    featureInitReports: [],
    outputInitReports: [],
  };
}

export interface MakeDeviceOpts {
  vendorId?: number;
  productId?: number;
  path?: string;
  interfaceNumber?: number;
  usagePage?: number;
  usage?: number;
  match?: ConfigMatch;
}

export function makeDevice(opts: MakeDeviceOpts = {}): DiscoveredDevice {
  const vendorId = opts.vendorId ?? 0x256C;
  const productId = opts.productId ?? 0x006E;
  const cfg = makeConfig({
    identifiers: [makeIdentifier({ vendorId, productId })],
  });
  return {
    vendorId,
    productId,
    path: opts.path ?? "DevA",
    interfaceNumber: opts.interfaceNumber ?? 0,
    usagePage: opts.usagePage ?? 0x0D,
    usage: opts.usage ?? 0x02,
    productString: "Test",
    manufacturerString: "Test Co",
    serialNumber: "",
    inputReportLength: null,
    match: opts.match ?? { config: cfg, identifier: cfg.digitizerIdentifiers[0] },
  };
}
