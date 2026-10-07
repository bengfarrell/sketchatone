"""Tests for atomic configuration writes."""

import json
import stat
from unittest.mock import patch

import pytest

from sketchatone.utils.config_file import write_config_file


def test_write_creates_valid_json(tmp_path):
    path = tmp_path / 'config.json'
    data = {'deviceButtons': {'keys': [], 'buttons': []}}
    write_config_file(str(path), data)
    assert json.loads(path.read_text()) == data
    assert list(tmp_path.iterdir()) == [path]


def test_replacement_preserves_permissions_and_ownership(tmp_path):
    path = tmp_path / 'config.json'
    path.write_text('{"old": true}')
    path.chmod(0o640)
    original = path.stat()

    write_config_file(str(path), {'new': True})

    assert json.loads(path.read_text()) == {'new': True}
    updated = path.stat()
    assert stat.S_IMODE(updated.st_mode) == 0o640
    assert (updated.st_uid, updated.st_gid) == (original.st_uid, original.st_gid)
    assert list(tmp_path.iterdir()) == [path]


def test_serialization_failure_leaves_original_untouched(tmp_path):
    path = tmp_path / 'config.json'
    original = '{"old": true}'
    path.write_text(original)

    with pytest.raises(TypeError):
        write_config_file(str(path), {'invalid': object()})

    assert path.read_text() == original
    assert list(tmp_path.iterdir()) == [path]


@pytest.mark.parametrize('operation', ['fsync', 'replace', 'fchmod'])
def test_write_failure_preserves_original_and_cleans_up(tmp_path, operation):
    path = tmp_path / 'config.json'
    original = '{"old": true}'
    path.write_text(original)

    with patch(f'sketchatone.utils.config_file.os.{operation}', side_effect=OSError('write failed')):
        with pytest.raises(OSError, match='write failed'):
            write_config_file(str(path), {'new': True})

    assert path.read_text() == original
    assert list(tmp_path.iterdir()) == [path]


def test_symlink_is_preserved(tmp_path):
    target = tmp_path / 'target.json'
    target.write_text('{"old": true}')
    link = tmp_path / 'config.json'
    link.symlink_to(target)

    write_config_file(str(link), {'new': True})

    assert link.is_symlink()
    assert json.loads(target.read_text()) == {'new': True}


def test_root_restores_ownership_before_replacement(tmp_path):
    path = tmp_path / 'config.json'
    path.write_text('{}')
    original = path.stat()
    with patch('sketchatone.utils.config_file.os.geteuid', return_value=0), \
         patch('sketchatone.utils.config_file.os.fchown') as chown:
        write_config_file(str(path), {'new': True})

    assert chown.call_args.args[1:] == (original.st_uid, original.st_gid)


def test_failed_new_file_write_does_not_leave_partial_config(tmp_path):
    path = tmp_path / 'config.json'
    with patch('sketchatone.utils.config_file.os.fsync', side_effect=OSError('write failed')):
        with pytest.raises(OSError, match='write failed'):
            write_config_file(str(path), {'new': True})

    assert list(tmp_path.iterdir()) == []
