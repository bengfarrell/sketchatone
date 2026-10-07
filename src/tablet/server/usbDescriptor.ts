/** Fallback HID report-descriptor reader via libusb.
 *
 * node-hid 3.x does not expose hid_get_report_descriptor(), so we send
 * the equivalent USB standard request directly through libusb. This
 * mirrors the path Python's cython-hidapi takes internally (via IOKit
 * on macOS, sysfs on Linux), giving us the actual Logical Maximum for
 * the standard digitizer interface when we can't trigger the firmware
 * vendor-mode handshake.
 *
 * Caveats: on macOS, IOHIDFamily claims HID interfaces and libusb may
 * refuse to claim them on top. We try with `interface` recipient first
 * (the spec-correct form) and fall back to `device` recipient, which
 * many tablets still honour and which doesn't require an interface
 * claim.
 */

import { usb } from "usb";

/** HID 1.11 §7.1.1: report descriptor type. */
const DESC_TYPE_REPORT = 0x22;
/** Standard GET_DESCRIPTOR request. */
const REQUEST_GET_DESCRIPTOR = 0x06;
/** libhidapi uses this; covers every real-world descriptor. */
const MAX_DESCRIPTOR_BYTES = 4096;

export interface UsbDescriptorOptions {
  /** Per-call timeout for the libusb open + transfer. */
  timeoutMs?: number;
}

/**
 * Try to read the raw HID report descriptor for one interface of a USB device.
 *
 * Returns null if the device isn't accessible (wrong permissions, kernel
 * driver attached, libusb not built for this platform, etc). Never throws.
 */
export async function getReportDescriptorViaUsb(
  vendorId: number,
  productId: number,
  interfaceNumber: number,
  _opts: UsbDescriptorOptions = {},
): Promise<Uint8Array | null> {
  let device: Awaited<ReturnType<typeof usb.findDeviceByIds>>;
  try {
    device = await usb.findDeviceByIds(vendorId, productId);
  } catch {
    return null;
  }
  if (!device) return null;

  let opened = false;
  let claimed = false;
  try {
    await device.open();
    opened = true;

    try {
      await device.claimInterface(interfaceNumber);
      claimed = true;
    } catch {
      // Kernel driver (e.g. IOHIDFamily on macOS) has the interface;
      // we'll fall back to a device-recipient request below.
    }

    const data = await readDescriptor(device, interfaceNumber, claimed);
    return data;
  } catch {
    return null;
  } finally {
    if (claimed) {
      try { await device.releaseInterface(interfaceNumber); } catch { /* noop */ }
    }
    if (opened) {
      try { await device.close(); } catch { /* noop */ }
    }
  }
}

async function readDescriptor(
  device: NonNullable<Awaited<ReturnType<typeof usb.findDeviceByIds>>>,
  interfaceNumber: number,
  interfaceClaimed: boolean,
): Promise<Uint8Array | null> {
  const value = (DESC_TYPE_REPORT << 8) | 0;
  const recipients: Array<"interface" | "device"> = interfaceClaimed
    ? ["interface", "device"]
    : ["device", "interface"];

  for (const recipient of recipients) {
    try {
      const result = await device.controlTransferIn(
        {
          requestType: "standard",
          recipient,
          request: REQUEST_GET_DESCRIPTOR,
          value,
          index: interfaceNumber,
        },
        MAX_DESCRIPTOR_BYTES,
      );
      if (result.status !== "ok" || !result.data) continue;
      const view = result.data;
      if (view.byteLength === 0) continue;
      return new Uint8Array(view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength));
    } catch {
      // try the next recipient
    }
  }
  return null;
}
