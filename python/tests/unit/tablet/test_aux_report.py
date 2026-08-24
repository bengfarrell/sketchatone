"""Tests for the raw HID aux scan-code parser."""

from __future__ import annotations

from sketchatone.tablet.server.aux_report import parse_aux_report


def _encoded(report_id: int, page: int, code: int) -> int:
    return ((report_id & 0xFF) << 24) | ((page & 0xFF) << 16) | (code & 0xFFFF)


def test_empty_input_returns_zero_id_and_no_codes() -> None:
    assert parse_aux_report(b"") == (0, [])


def test_keyboard_8byte_boot_layout_yields_chorded_code() -> None:
    # report_id=2, modifier=Ctrl(0x01), reserved=0, k1=0x1E ('1')
    data = bytes([2, 0x01, 0x00, 0x1E, 0, 0, 0, 0, 0])
    rid, codes = parse_aux_report(data)
    assert rid == 2
    assert codes == [_encoded(2, 0x07, (0x01 << 8) | 0x1E)]


def test_keyboard_7byte_compact_layout() -> None:
    # 7-byte body: [mod, k1..k6]; report_id=3, mod=0, k1=0x04 ('a')
    data = bytes([3, 0x00, 0x04, 0, 0, 0, 0, 0])
    rid, codes = parse_aux_report(data)
    assert rid == 3
    assert codes == [_encoded(3, 0x07, 0x04)]


def test_keyboard_modifier_only_emits_one_code_per_bit() -> None:
    # 8-byte body, no keys pressed, modifier = Ctrl|Shift = 0x03.
    data = bytes([4, 0x03, 0x00, 0, 0, 0, 0, 0, 0])
    rid, codes = parse_aux_report(data)
    assert rid == 4
    assert codes == [
        _encoded(4, 0x07, 0xE000 | 0x01),
        _encoded(4, 0x07, 0xE000 | 0x02),
    ]


def test_keyboard_duplicate_keys_dedup_preserves_order() -> None:
    # Same key in two slots should appear once.
    data = bytes([5, 0x00, 0x00, 0x05, 0x05, 0x07, 0, 0, 0])
    rid, codes = parse_aux_report(data)
    assert rid == 5
    assert codes == [
        _encoded(5, 0x07, 0x05),
        _encoded(5, 0x07, 0x07),
    ]


def test_consumer_2byte_report_combines_le_code() -> None:
    # report_id=1, consumer code 0x00B5 ("Scan Next Track") little-endian.
    data = bytes([1, 0xB5, 0x00])
    rid, codes = parse_aux_report(data)
    assert rid == 1
    assert codes == [_encoded(1, 0x0C, 0x00B5)]


def test_consumer_1byte_report() -> None:
    data = bytes([6, 0x10])
    rid, codes = parse_aux_report(data)
    assert rid == 6
    assert codes == [_encoded(6, 0x0C, 0x10)]


def test_consumer_3byte_report_uses_first_two_bytes() -> None:
    # body length 3 still routes through consumer branch; third byte ignored.
    data = bytes([7, 0xCD, 0x00, 0xFF])
    rid, codes = parse_aux_report(data)
    assert rid == 7
    assert codes == [_encoded(7, 0x0C, 0x00CD)]


def test_consumer_zero_payload_yields_no_codes_but_keeps_id() -> None:
    rid, codes = parse_aux_report(bytes([9, 0x00, 0x00]))
    assert rid == 9 and codes == []


def test_generic_fallback_encodes_position_and_value() -> None:
    # body length 4 -> generic path: encodes (i << 8) | byte under page 0xFF.
    data = bytes([8, 0x00, 0x11, 0x00, 0x22])
    rid, codes = parse_aux_report(data)
    assert rid == 8
    assert codes == [
        _encoded(8, 0xFF, (1 << 8) | 0x11),
        _encoded(8, 0xFF, (3 << 8) | 0x22),
    ]


def test_codes_are_unique_per_report_id() -> None:
    # Same logical key on different report IDs encodes to different ints.
    _, codes_a = parse_aux_report(bytes([1, 0x00, 0x00, 0x04, 0, 0, 0, 0, 0]))
    _, codes_b = parse_aux_report(bytes([2, 0x00, 0x00, 0x04, 0, 0, 0, 0, 0]))
    assert codes_a != codes_b
    assert codes_a[0] >> 24 == 1
    assert codes_b[0] >> 24 == 2
