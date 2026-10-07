"""Atomic JSON configuration writes."""

import json
import os
import stat
import tempfile
from typing import Any


def write_config_file(path: str, data: Any) -> None:
    """Replace a config only after serialization and writing have succeeded."""
    serialized = json.dumps(data, indent=2)
    # Follow symlinks as an ordinary write would, rather than replacing the link.
    destination = os.path.realpath(path)
    try:
        original = os.stat(destination)
    except FileNotFoundError:
        original = None

    with tempfile.TemporaryDirectory(
        dir=os.path.dirname(destination), prefix='.sketchatone-config-',
    ) as temporary_dir:
        temporary_path = os.path.join(temporary_dir, 'config.json')
        with open(temporary_path, 'w', encoding='utf-8') as f:
            f.write(serialized)
            f.flush()
            os.fsync(f.fileno())

            if original is not None:
                temporary = os.fstat(f.fileno())
                if os.geteuid() == 0 or (
                    temporary.st_uid, temporary.st_gid
                ) != (original.st_uid, original.st_gid):
                    os.fchown(f.fileno(), original.st_uid, original.st_gid)
                os.fchmod(f.fileno(), stat.S_IMODE(original.st_mode))
            elif os.geteuid() == 0:
                os.fchmod(f.fileno(), 0o666)

        os.replace(temporary_path, destination)
