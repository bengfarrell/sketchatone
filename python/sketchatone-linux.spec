# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec file for Sketchatone on Linux/Raspberry Pi
Builds a standalone application bundle
"""

import sys
import os
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None

# Get the spec file directory
spec_dir = os.path.dirname(os.path.abspath(SPEC))
project_root = os.path.dirname(spec_dir)

# Collect all data files
datas = [
    # Include the built webapp (dist/public)
    (os.path.join(project_root, 'dist', 'public'), 'public'),
    # Include device configs
    (os.path.join(project_root, 'public', 'configs'), 'configs'),
]

# Hidden imports that PyInstaller might miss
hiddenimports = [
    # Core dependencies
    'websockets',
    'websockets.legacy',
    'websockets.legacy.server',
    'hid',
    'hidapi',
    'rtmidi',
    'rtmidi._rtmidi',
    'inquirer',
    'colorama',
    # Sketchatone modules
    'sketchatone',
    'sketchatone.cli',
    'sketchatone.cli.server',
    'sketchatone.cli.midi_strummer',
    'sketchatone.cli.strum_event_viewer',
    'sketchatone.strummer',
    'sketchatone.strummer.strummer',
    'sketchatone.strummer.actions',
    'sketchatone.midi',
    'sketchatone.midi.bridge',
    'sketchatone.midi.protocol',
    'sketchatone.midi.rtmidi_input',
    'sketchatone.midi.rtmidi_output',
    'sketchatone.midi.jack_output',
    'sketchatone.models',
    'sketchatone.models.midi_strummer_config',
    'sketchatone.models.note',
    'sketchatone.models.server_config',
    'sketchatone.utils',
    # Blankslate modules (tablet reading)
    'blankslate',
    'blankslate.cli',
    'blankslate.cli.tablet_reader_base',
    'blankslate.utils',
    'blankslate.utils.finddevice',
    'blankslate.models',
]

# Collect all submodules for key packages
hiddenimports += collect_submodules('sketchatone')
hiddenimports += collect_submodules('blankslate')

a = Analysis(
    ['sketchatone/cli/server.py'],
    pathex=[spec_dir],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude dev dependencies
        'pytest',
        'pytest_asyncio',
        'pytest_cov',
        'black',
        'mypy',
        'ruff',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='sketchatone',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,  # Linux runs in terminal
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='sketchatone',
)
