"""Strict structural validation for complete web configuration replacements."""

import math
import re
from .midi_strummer_config import MidiStrummerConfig
from .chord_mode import resolve_chord_mode_entry


def config_validation_template():
    template = MidiStrummerConfig().to_dict()
    template['strummer']['strumming']['chord'] = ''
    template['strummer']['chordProgressions'] = {'*': ['']}
    template['strummer']['chordModes'] = {'*': [{
        'degree': 1, 'alteration': 0, 'quality': 'major', 'extension': 'none',
        'display': '', 'spelling': 'auto',
    }]}
    template['strummer']['actionRules'] = {
        'rules': [{'id': '', 'name': '', 'button': '', 'action': '', 'trigger': 'press'}],
        'groups': [{'id': '', 'name': '', 'buttons': ['']}],
        'groupRules': [{'id': '', 'name': '', 'groupId': '',
                       'action': {'type': '', 'progression': '', 'octave': 4}, 'trigger': 'press'}],
        'startupRules': [{'id': '', 'name': '', 'action': ''}],
    }
    template['deviceButtons'] = {'buttons': [{'code': 0, 'name': ''}], 'keys': [{'key': '', 'name': ''}]}
    template['midi']['midiPassthrough'] = [{'inputPort': None, 'outputPort': None}]
    return template


ENUMS = {
    'mode': ['strum', 'slide'],
    'inputMode': ['direct', 'majorScale', 'minorScale', 'autoScale'],
    'midiOutputBackend': ['rtmidi', 'jack'],
    'trigger': ['press', 'release', 'hold'],
    'spread': ['direct', 'inverse', 'central', 'none'],
    'control': ['none', 'pressure', 'tiltX', 'tiltY', 'tiltXY', 'xaxis', 'yaxis', 'velocity'],
    'quality': ['major', 'minor', 'diminished', 'half-diminished', 'augmented', 'sus2', 'sus4', 'power'],
    'extension': ['none', '6', '7', 'maj7', '9', 'maj9', 'add9', 'm7b5'],
    'spelling': ['auto', 'flat', 'sharp'],
}
NULLABLE = {'chord', 'device', 'httpPort', 'httpsPort', 'wsPort', 'wssPort',
            'deviceFindingPollInterval', 'midiChannel', 'jackAutoConnect'}
PORTS = {'outputPort', 'inputPort', 'midiOutputId', 'midiInputId'}
ALIASES = {'outputPort': 'midiOutputId', 'inputPort': 'midiInputId',
           'inputExclude': 'midiInputExclude', 'outputExclude': 'midiOutputExclude'}


def validate_complete_config(value, template=None):
    errors = []
    template = template or config_validation_template()

    def fail(path, message):
        errors.append(f'{path}: {message}')

    def number(data):
        return type(data) in (int, float) and math.isfinite(data)

    def integer(data):
        return number(data) and int(data) == data

    def walk(data, sample, path, key=''):
        if data is None and key in NULLABLE:
            return
        if key in PORTS:
            def port(v):
                return v is None or isinstance(v, str) or (integer(v) and v >= 0)
            if not (port(data) or (key in ('inputPort', 'midiInputId') and
                                   isinstance(data, list) and all(integer(v) and v >= 0 for v in data))):
                fail(path, 'expected port name, nonnegative index, null, or input port list')
            return
        if key == 'action' and isinstance(sample, str):
            if not (isinstance(data, str) or (isinstance(data, list) and data and isinstance(data[0], str))):
                fail(path, 'expected action name or [name, parameters…]')
            return
        if sample is None:
            if not (isinstance(data, str) if key == 'device' else number(data)):
                fail(path, 'expected string or number, or null')
        elif isinstance(sample, list):
            if not isinstance(data, list):
                return fail(path, 'expected array')
            for i, entry in enumerate(data):
                walk(entry, sample[0] if sample else '', f'{path}[{i}]')
        elif isinstance(sample, dict):
            if not isinstance(data, dict):
                return fail(path, 'expected object')
            if re.search(r'chordModes\.[^.]+\[\d+\]$', path) and not resolve_chord_mode_entry(data):
                fail(path, 'invalid chord-mode entry or quality/extension combination')
            required = []
            for pattern, fields in [
                (r'deviceButtons\.buttons\[\d+\]$', ['code', 'name']),
                (r'deviceButtons\.keys\[\d+\]$', ['key', 'name']),
                (r'actionRules\.rules\[\d+\]$', ['id', 'button', 'action']),
                (r'actionRules\.groups\[\d+\]$', ['id', 'name', 'buttons']),
                (r'actionRules\.groupRules\[\d+\]$', ['id', 'groupId', 'action']),
                (r'actionRules\.startupRules\[\d+\]$', ['id', 'action']),
                (r'midiPassthrough\[\d+\]$', ['inputPort', 'outputPort']),
                (r'groupRules\[\d+\]\.action$', ['type']),
            ]:
                if re.search(pattern, path):
                    required = fields
            for field in required:
                snake = re.sub(r'[A-Z]', lambda m: '_' + m[0].lower(), field)
                if field not in data and snake not in data:
                    fail(f'{path}.{field}', 'required field')
            seen = set()
            for raw, entry in data.items():
                field = re.sub(r'_([a-z])', lambda m: m[1].upper(), raw)
                if field not in sample:
                    field = ALIASES.get(field, field)
                if field in ('__proto__', 'constructor', 'prototype'):
                    fail(f'{path}.{raw}', 'unsupported field')
                    continue
                if field in seen:
                    fail(f'{path}.{raw}', 'duplicate alias')
                seen.add(field)
                if field not in sample and '*' not in sample:
                    fail(f'{path}.{raw}', 'unsupported field')
                    continue
                walk(entry, sample.get(field, sample.get('*')), f'{path}.{field}', '' if '*' in sample else field)
            if number(data.get('min')) and number(data.get('max')) and data['min'] > data['max']:
                fail(path, 'min must not exceed max')
        elif (number(sample) and not number(data)) or (not number(sample) and type(data) is not type(sample)):
            return fail(path, f'expected {type(sample).__name__}')
        if key in ENUMS and data not in ENUMS[key]:
            fail(path, 'expected ' + ', '.join(ENUMS[key]))
        if key == 'type' and 'groupRules' in path and data not in ('chord-progression', 'chord-mode'):
            fail(path, 'expected chord-progression or chord-mode')
        if key == 'type' and 'pressureModulation' in path and data not in ('none', 'aftertouch', 'cc'):
            fail(path, 'expected none, aftertouch or cc')
        if key == 'startingRoot' and (not isinstance(data, str) or not re.fullmatch(r'[A-G](#|b)?', data)):
            fail(path, 'expected root note such as C or Bb')
        if isinstance(data, str) and re.search(r'initialNotes\[\d+\]$', path) and not re.fullmatch(r'[A-Ga-g](#|b)?-?\d+', data):
            fail(path, 'expected note with octave such as C4')
        if number(data):
            if key == 'midiChannel' and not (integer(data) and 1 <= data <= 16):
                fail(path, 'expected MIDI channel 1–16 or null')
            if key == 'channel' and not (integer(data) and 0 <= data <= 15):
                fail(path, 'expected MIDI channel 0–15')
            if key in ('midiNote', 'ccNumber', 'minValue', 'maxValue') and not (integer(data) and 0 <= data <= 127):
                fail(path, 'expected integer 0–127')
            if key == 'curve' and data <= 0:
                fail(path, 'must be positive')
            if key == 'randomization' and not 0 <= data <= 1:
                fail(path, 'expected 0–1')
            if key in ('upperNoteSpread', 'lowerNoteSpread', 'startingOffset', 'startingOctave', 'octave', 'code') and not integer(data):
                fail(path, 'expected integer')
            if key in ('httpPort', 'httpsPort', 'wsPort', 'wssPort') and not (integer(data) and 1 <= data <= 65535):
                fail(path, 'expected port 1–65535')
            if key == 'pressureThreshold' and not 0 <= data <= 1:
                fail(path, 'expected 0–1')
            if key == 'pressureBufferSize' and not (integer(data) and data >= 1):
                fail(path, 'expected positive integer')
            if key in ('wsMessageThrottle', 'deviceFindingPollInterval', 'maxDuration',
                       'defaultNoteDuration', 'midiInterMessageDelay', 'upperNoteSpread', 'lowerNoteSpread') and data < 0:
                fail(path, 'must be nonnegative')
            if key == 'degree' and not (integer(data) and 1 <= data <= 7):
                fail(path, 'expected degree 1–7')
            if key == 'alteration' and not (integer(data) and abs(data) <= 2):
                fail(path, 'expected integer −2–2')

    if not isinstance(value, dict):
        return ['$: expected configuration object']
    for section in ('strummer', 'midi', 'server'):
        if section not in value:
            fail(section, 'required section')
    def check_json(data, path):
        if isinstance(data, float) and not math.isfinite(data):
            fail(path, 'expected finite JSON number')
        elif isinstance(data, list):
            for i, entry in enumerate(data):
                check_json(entry, f'{path}[{i}]')
        elif isinstance(data, dict):
            for key, entry in data.items():
                check_json(entry, f'{path}.{key}')
    check_json(value, '$')
    walk(value, template, '$')
    return errors


_DEFAULT_TEMPLATE = object()


def normalize_complete_config(value, template=_DEFAULT_TEMPLATE):
    if template is _DEFAULT_TEMPLATE:
        template = config_validation_template()
    if template is None:
        return value
    if isinstance(value, list):
        return [normalize_complete_config(entry, template[0]) for entry in value]
    if not isinstance(value, dict) or not isinstance(template, dict):
        return value
    result = {}
    for raw, entry in value.items():
        if '*' in template:
            result[raw] = normalize_complete_config(entry, template['*'])
            continue
        field = re.sub(r'_([a-z])', lambda m: m[1].upper(), raw)
        if field not in template:
            field = ALIASES.get(field, field)
        result[field] = normalize_complete_config(entry, template.get(field))
    return result
