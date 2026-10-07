/**
 * Decode raw scan codes from a tablet's auxiliary HID interface.
 *
 * Tablets surface their hardware express keys through standard Keyboard
 * (usage page 0x01) or Consumer Control (usage page 0x0C) collections.
 * On macOS multiple top-level collections often share one IOHIDDevice
 * handle, so we dispatch on the Report ID rather than the path's
 * declared usage page. Clients receive the raw firmware-level
 * identifiers so they can build their own per-device mappings.
 */

const KEYBOARD_USAGE_PAGE = 0x07;
const CONSUMER_USAGE_PAGE = 0x0C;

function encode(reportId: number, page: number, code: number): number {
  return (
    ((reportId & 0xFF) << 24) |
    ((page & 0xFF) << 16) |
    (code & 0xFFFF)
  ) >>> 0;
}

/**
 * Index in `body` where keycodes start for a keyboard-style report.
 *
 * Standard boot keyboard is 8 bytes `[mod, reserved, k1..k6]`; many
 * tablet firmwares ship a compressed 7-byte `[mod, k1..k6]` variant.
 * Both have modifier in byte 0.
 */
function keyboardKeysOffset(body: Uint8Array): number | null {
  if (body.length === 8 && body[1] === 0) return 2;
  if (body.length === 7) return 1;
  return null;
}

export interface AuxParseResult {
  reportId: number;
  codes: number[];
}

/**
 * Return `{reportId, codes}` for one aux HID report.
 *
 * Each code is encoded as `(reportId << 24) | (page << 16) | code`
 * so values are unique across report IDs and HID pages on the same
 * composite interface, and stable per physical button. Keyboard
 * presses combine the modifier byte and keycode into a single 16-bit
 * payload so a chorded shortcut (e.g. Ctrl+1) yields one code rather
 * than separate modifier / key codes that would alias across buttons.
 */
export function parseAuxReport(data: Uint8Array): AuxParseResult {
  if (data.length === 0) return { reportId: 0, codes: [] };
  const reportId = data[0];
  const body = data.subarray(1);
  const codes: number[] = [];

  const keysOffset = keyboardKeysOffset(body);
  if (keysOffset !== null) {
    const modifier = body[0];
    const activeKeys: number[] = [];
    for (let i = keysOffset; i < body.length; i++) {
      if (body[i] !== 0) activeKeys.push(body[i]);
    }
    if (activeKeys.length > 0) {
      for (const k of activeKeys) {
        codes.push(encode(reportId, KEYBOARD_USAGE_PAGE, (modifier << 8) | k));
      }
    } else if (modifier !== 0) {
      for (let bit = 0; bit < 8; bit++) {
        if ((modifier & (1 << bit)) !== 0) {
          codes.push(encode(reportId, KEYBOARD_USAGE_PAGE, 0xE000 | (1 << bit)));
        }
      }
    }
  } else if (body.length >= 1 && body.length <= 3) {
    const code = body.length >= 2 ? (body[0] | (body[1] << 8)) : body[0];
    if (code !== 0) codes.push(encode(reportId, CONSUMER_USAGE_PAGE, code));
  } else {
    for (let i = 0; i < body.length; i++) {
      if (body[i] !== 0) codes.push(encode(reportId, 0xFF, (i << 8) | body[i]));
    }
  }

  const seen = new Set<number>();
  const out: number[] = [];
  for (const c of codes) {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  }
  return { reportId, codes: out };
}
