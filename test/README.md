# Sketchatone Testing Guide

This document describes the testing infrastructure for Sketchatone.

## Test Types

### 1. Unit Tests (Fast, No Hardware)

**Location**: `test/unit/*.test.ts` and `python/tests/unit/test_*.py`

**What they test**:
- MIDI message formatting (Note On/Off, Pitch Bend, CC)
- Note scheduling and timer management
- Active note tracking
- Channel handling
- Configuration serialization

**Running**:
```bash
# TypeScript
npm test

# Python
cd python && pytest tests/unit/
```

**Coverage**: 321 tests (308 TypeScript + 13 Python unit)

### 2. Virtual MIDI Integration Tests (Real MIDI Library, No Hardware)

**Location**: `test/integration/virtual-midi.test.ts` and `python/tests/integration/test_virtual_midi.py`

**What they test**:
- Real RtMidi library integration
- Real MIDI byte transmission through virtual ports
- MIDI passthrough functionality
- State Guard (prevents Note Shadowing)
- Hot-swap device monitoring
- JACK MIDI backend (Linux only)

**Requirements**:

**macOS**:
1. Open "Audio MIDI Setup" (/Applications/Utilities/)
2. Window → Show MIDI Studio
3. Double-click "IAC Driver"
4. Check "Device is online"
5. Create at least one port (e.g., "Bus 1")
6. Click "Apply"

**Linux**:
```bash
# Load virtual MIDI kernel module
sudo modprobe snd-virmidi

# (Optional) Make permanent
echo "snd-virmidi" | sudo tee -a /etc/modules

# Verify
aplaymidi -l
```

**Running**:
```bash
# TypeScript
npm test -- test/integration/virtual-midi.test.ts

# Python
cd python && pytest tests/integration/test_virtual_midi.py -v
```

**Coverage**: 17 tests (8 TypeScript + 8 Python + 1 Python JACK on Linux)

**What Happens If Virtual MIDI Is Not Available?**

Tests will be skipped with instructions:
```
⚠️  Skipping virtual MIDI tests - virtual MIDI not available

Virtual MIDI not available. To enable:
[... setup instructions ...]
```

## CI/CD Testing

GitHub Actions runs:
- ✅ All unit tests (both languages)
- ✅ Virtual MIDI integration tests on Linux (snd-virmidi)
- ✅ Virtual MIDI integration tests on macOS (IAC Driver)

See `.github/workflows/test.yml` for configuration.

## Test Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Mock Tests                            │
│  ✓ Fast (milliseconds)                                      │
│  ✓ No hardware required                                     │
│  ✓ Run in CI/CD always                                      │
│  ✓ Test MIDI message formatting                             │
│  └─ test/unit/midi-backend.test.ts                          │
│  └─ python/tests/unit/test_midi_backend.py                  │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   Virtual MIDI Tests                         │
│  ✓ Medium speed (seconds)                                   │
│  ✓ Virtual MIDI driver required                             │
│  ✓ Run in CI/CD on Linux/macOS                              │
│  ✓ Test real RtMidi/JACK library integration                │
│  └─ test/integration/virtual-midi.test.ts                   │
│  └─ python/tests/integration/test_virtual_midi.py           │
└─────────────────────────────────────────────────────────────┘
                           ↓
┌─────────────────────────────────────────────────────────────┐
│                   Hardware Tests                             │
│  ✓ Slow (manual)                                            │
│  ✓ Physical MIDI device required                            │
│  ✓ Manual testing only                                      │
│  ✓ Test with real synthesizers                              │
│  └─ Run `sketchatone-server` with real hardware             │
└─────────────────────────────────────────────────────────────┘
```

## Running All Tests

```bash
# Run everything (unit + integration)
npm test && cd python && pytest

# Run only fast unit tests
npm test -- test/unit/ && cd python && pytest tests/unit/

# Run only virtual MIDI tests (requires setup)
npm test -- test/integration/virtual-midi.test.ts
```

## Test Coverage Summary

- **Total Tests**: 329+ tests
- **Unit Tests (Mock)**: 321 tests
  - TypeScript: 308 tests
  - Python: 13 tests
- **Integration Tests (Virtual MIDI)**: 8+ tests
  - TypeScript: 8 tests
  - Python: 9 tests (JACK + RtMidi)
- **Test Execution Time**: < 5 seconds (unit), < 10 seconds (integration)

## What's Protected

- ✅ MIDI octave standardization (C4 = 60)
- ✅ MIDI message byte formatting
- ✅ Note scheduling and automatic note-off
- ✅ Active note tracking
- ✅ State Guard (prevents note shadowing)
- ✅ Channel routing (0-15)
- ✅ Pitch bend (14-bit values)
- ✅ Backend parity (Python ↔ Node.js)
- ✅ Device hot-swapping
- ✅ MIDI passthrough
