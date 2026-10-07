/**
 * TypeScript ports of OpenTabletDriver's IDeviceReport hierarchy.
 *
 * All values are kept in the tablet's native units; normalization happens in the
 * event adapter layer.
 */

export function u16le(data: Uint8Array, offset: number): number {
  return data[offset] | (data[offset + 1] << 8);
}

export function s8(b: number): number {
  return b >= 128 ? b - 256 : b;
}

export function bit(b: number, n: number): boolean {
  return ((b >> n) & 1) === 1;
}

export type Tuple2 = [number, number];

export class DeviceReport {
  readonly kind = "DeviceReport" as const;
  constructor(public raw: Uint8Array) {}
}

export class OutOfRangeReport {
  readonly kind = "OutOfRangeReport" as const;
  constructor(public raw: Uint8Array) {}
}

export class TabletReport {
  readonly kind = "TabletReport" as const;
  raw: Uint8Array;
  position: Tuple2 = [0, 0];
  pressure = 0;
  penButtons: boolean[] = [];

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): TabletReport {
    const r = new TabletReport(data);
    r.position = [u16le(data, 2), u16le(data, 4)];
    r.pressure = u16le(data, 6);
    r.penButtons = [bit(data[1], 1), bit(data[1], 2), bit(data[1], 3)];
    return r;
  }
}

export class TiltTabletReport {
  readonly kind = "TiltTabletReport" as const;
  raw: Uint8Array;
  position: Tuple2 = [0, 0];
  pressure = 0;
  tilt: Tuple2 = [0, 0];
  penButtons: boolean[] = [];
  eraser = false;

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array,
               invertTiltX = false,
               invertTiltY = false): TiltTabletReport {
    const sx = invertTiltX ? -1 : 1;
    const sy = invertTiltY ? -1 : 1;
    const r = new TiltTabletReport(data);
    r.position = [u16le(data, 2), u16le(data, 4)];
    r.pressure = u16le(data, 6);
    r.tilt = [sx * s8(data[10]), sy * s8(data[11])];
    r.penButtons = [bit(data[1], 1), bit(data[1], 2), bit(data[1], 3)];
    return r;
  }
}

/**
 * Pen report from a tablet's standard HID digitizer interface.
 *
 * Layout observed on Huion, XP-Pen and similar tablets when reading
 * their OS-compatibility (UsagePage 0x0D) interface without sending
 * the vendor mode-switch init:
 *
 *     byte 0     report id
 *     byte 1     status bits
 *                  bit 0  tip switch (contact)
 *                  bit 1  barrel switch
 *                  bit 2  barrel switch 2 / eraser
 *                  bit 7  in range
 *     bytes 2-3  X (little-endian u16)
 *     bytes 4-5  Y (little-endian u16)
 *     bytes 6-7  pressure (little-endian u16)
 *     bytes 8-9  tilt X / tilt Y (signed bytes, optional)
 */
export class StandardDigitizerReport {
  readonly kind = "StandardDigitizerReport" as const;
  raw: Uint8Array;
  position: Tuple2 = [0, 0];
  pressure = 0;
  tilt: Tuple2 = [0, 0];
  penButtons: boolean[] = [];
  eraser = false;
  inRange = true;

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array, invertTiltY = true): StandardDigitizerReport {
    const status = data[1];
    let tilt: Tuple2 = [0, 0];
    if (data.length >= 10) {
      const sy = invertTiltY ? -1 : 1;
      tilt = [s8(data[8]), sy * s8(data[9])];
    }
    const r = new StandardDigitizerReport(data);
    r.position = [u16le(data, 2), u16le(data, 4)];
    r.pressure = u16le(data, 6);
    r.tilt = tilt;
    r.penButtons = [bit(status, 1), bit(status, 2)];
    r.eraser = bit(status, 2);
    r.inRange = bit(status, 7);
    return r;
  }
}

export class AuxReport {
  readonly kind = "AuxReport" as const;
  raw: Uint8Array;
  auxButtons: boolean[] = [];

  constructor(raw: Uint8Array) { this.raw = raw; }

  static parse(data: Uint8Array): AuxReport {
    const b = data[3];
    const r = new AuxReport(data);
    r.auxButtons = [bit(b, 0), bit(b, 1), bit(b, 2), bit(b, 3)];
    return r;
  }
}

export type AnyReport =
  | DeviceReport
  | OutOfRangeReport
  | TabletReport
  | TiltTabletReport
  | StandardDigitizerReport
  | AuxReport;
