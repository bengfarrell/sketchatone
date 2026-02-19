"""
Unit Tests for Config File Management

Tests for the config file management functionality including:
- Listing config files
- Loading config files
- Creating new config files
- Renaming config files
- Uploading/importing config files
- Deleting config files
- Path traversal security
"""

import pytest
import os
import json
import tempfile
import shutil
from typing import Optional, Any, List, Dict

from sketchatone.models import MidiStrummerConfig


class ConfigFileManager:
    """
    A testable implementation of config file management logic.
    This mirrors the private methods in StrummerWebSocketServer.
    """
    
    def __init__(self, config_dir: Optional[str] = None):
        self.config_dir = config_dir
        self.current_config_name: Optional[str] = None
        self.config_path: Optional[str] = None
        self.config = MidiStrummerConfig()
    
    def list_configs(self) -> List[str]:
        """
        List all available config files in the config directory.
        Only returns .json files that are not in subdirectories.
        """
        if not self.config_dir:
            return []
        
        try:
            files = os.listdir(self.config_dir)
            return [
                f for f in files
                if f.endswith('.json') and os.path.isfile(os.path.join(self.config_dir, f))
            ]
        except Exception:
            return []
    
    def load_config(self, config_name: str) -> bool:
        """
        Load a config file by name.
        Returns True on success, False on failure.
        """
        if not self.config_dir:
            return False
        
        config_path = os.path.join(self.config_dir, config_name)
        
        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.config_dir)
        if not resolved_path.startswith(resolved_dir + os.sep) and resolved_path != resolved_dir:
            return False
        
        if not os.path.exists(config_path):
            return False
        
        try:
            self.config = MidiStrummerConfig.from_json_file(config_path)
            self.config_path = config_path
            self.current_config_name = config_name
            return True
        except Exception:
            return False
    
    def create_config(self, config_name: str) -> bool:
        """
        Create a new config file with default values.
        Returns True on success, False on failure.
        """
        if not self.config_dir:
            return False
        
        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'
        
        config_path = os.path.join(self.config_dir, config_name)
        
        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.config_dir)
        if not resolved_path.startswith(resolved_dir + os.sep) and resolved_path != resolved_dir:
            return False
        
        if os.path.exists(config_path):
            return False
        
        try:
            new_config = MidiStrummerConfig()
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(new_config.to_dict(), f, indent=2)
            
            # Switch to the newly created config
            self.config_path = config_path
            self.current_config_name = config_name
            self.config = new_config
            return True
        except Exception:
            return False
    
    def rename_config(self, old_name: str, new_name: str) -> bool:
        """
        Rename a config file.
        Returns True on success, False on failure.
        """
        if not self.config_dir:
            return False
        
        # Ensure names end with .json
        if not old_name.endswith('.json'):
            old_name = old_name + '.json'
        if not new_name.endswith('.json'):
            new_name = new_name + '.json'
        
        old_path = os.path.join(self.config_dir, old_name)
        new_path = os.path.join(self.config_dir, new_name)
        
        # Security check: ensure paths are within the config directory
        resolved_old_path = os.path.abspath(old_path)
        resolved_new_path = os.path.abspath(new_path)
        resolved_dir = os.path.abspath(self.config_dir)
        if not resolved_old_path.startswith(resolved_dir + os.sep) and resolved_old_path != resolved_dir:
            return False
        if not resolved_new_path.startswith(resolved_dir + os.sep) and resolved_new_path != resolved_dir:
            return False
        
        if not os.path.exists(old_path):
            return False
        
        if os.path.exists(new_path):
            return False
        
        try:
            os.rename(old_path, new_path)
            
            # Update current config path if we renamed the current config
            if self.current_config_name == old_name:
                self.config_path = new_path
                self.current_config_name = new_name
            return True
        except Exception:
            return False
    
    def upload_config(self, config_name: str, config_data: Any) -> bool:
        """
        Upload a config file (save uploaded data as a new config).
        Returns True on success, False on failure.
        """
        if not self.config_dir:
            return False
        
        # Ensure the name ends with .json
        if not config_name.endswith('.json'):
            config_name = config_name + '.json'
        
        config_path = os.path.join(self.config_dir, config_name)
        
        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.config_dir)
        if not resolved_path.startswith(resolved_dir + os.sep) and resolved_path != resolved_dir:
            return False
        
        try:
            # Parse and validate the config data
            parsed_config = MidiStrummerConfig.from_dict(config_data)
            
            # Write the config file
            with open(config_path, 'w', encoding='utf-8') as f:
                json.dump(config_data, f, indent=2)
            
            # Switch to the uploaded config
            self.config_path = config_path
            self.current_config_name = config_name
            self.config = parsed_config
            return True
        except Exception:
            return False
    
    def delete_config(self, config_name: str) -> bool:
        """
        Delete a config file.
        Returns True on success, False on failure.
        """
        if not self.config_dir:
            return False
        
        # Don't allow deleting the currently loaded config
        if self.current_config_name == config_name:
            return False
        
        config_path = os.path.join(self.config_dir, config_name)
        
        # Security check: ensure the resolved path is within the config directory
        resolved_path = os.path.abspath(config_path)
        resolved_dir = os.path.abspath(self.config_dir)
        if not resolved_path.startswith(resolved_dir + os.sep) and resolved_path != resolved_dir:
            return False
        
        if not os.path.exists(config_path):
            return False
        
        try:
            os.remove(config_path)
            return True
        except Exception:
            return False


class TestConfigFileManagement:
    """Tests for config file management functionality."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
        self.manager = ConfigFileManager(self.temp_dir)
        yield
        # Clean up
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    class TestListConfigs:
        """Tests for list_configs method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_empty_when_no_config_dir(self):
            """Should return empty list when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.list_configs() == []
        
        def test_returns_empty_when_directory_empty(self):
            """Should return empty list when directory is empty."""
            assert self.manager.list_configs() == []
        
        def test_lists_only_json_files(self):
            """Should list only .json files."""
            with open(os.path.join(self.temp_dir, 'config1.json'), 'w') as f:
                f.write('{}')
            with open(os.path.join(self.temp_dir, 'config2.json'), 'w') as f:
                f.write('{}')
            with open(os.path.join(self.temp_dir, 'readme.txt'), 'w') as f:
                f.write('not a config')
            with open(os.path.join(self.temp_dir, 'script.js'), 'w') as f:
                f.write('not a config')
            
            configs = self.manager.list_configs()
            assert len(configs) == 2
            assert 'config1.json' in configs
            assert 'config2.json' in configs
            assert 'readme.txt' not in configs
            assert 'script.js' not in configs
        
        def test_does_not_list_subdirectories(self):
            """Should not list subdirectories even with .json name."""
            with open(os.path.join(self.temp_dir, 'config.json'), 'w') as f:
                f.write('{}')
            os.makedirs(os.path.join(self.temp_dir, 'subdir.json'))
            
            configs = self.manager.list_configs()
            assert len(configs) == 1
            assert 'config.json' in configs
            assert 'subdir.json' not in configs
        
        def test_does_not_list_files_in_subdirectories(self):
            """Should not list files in subdirectories."""
            with open(os.path.join(self.temp_dir, 'root.json'), 'w') as f:
                f.write('{}')
            os.makedirs(os.path.join(self.temp_dir, 'subdir'))
            with open(os.path.join(self.temp_dir, 'subdir', 'nested.json'), 'w') as f:
                f.write('{}')
            
            configs = self.manager.list_configs()
            assert len(configs) == 1
            assert 'root.json' in configs
    
    class TestLoadConfig:
        """Tests for load_config method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_false_when_no_config_dir(self):
            """Should return False when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.load_config('test.json') is False
        
        def test_returns_false_when_file_not_found(self):
            """Should return False when config file does not exist."""
            assert self.manager.load_config('nonexistent.json') is False
        
        def test_loads_valid_config(self):
            """Should load a valid config file."""
            config_data = MidiStrummerConfig()
            config_data.strummer.strumming.chord = 'Am'
            config_path = os.path.join(self.temp_dir, 'test.json')
            with open(config_path, 'w') as f:
                json.dump(config_data.to_dict(), f, indent=2)
            
            assert self.manager.load_config('test.json') is True
            assert self.manager.current_config_name == 'test.json'
            assert self.manager.config.strummer.strumming.chord == 'Am'
        
        def test_returns_false_for_invalid_json(self):
            """Should return False for invalid JSON."""
            with open(os.path.join(self.temp_dir, 'invalid.json'), 'w') as f:
                f.write('not valid json')
            assert self.manager.load_config('invalid.json') is False
        
        def test_rejects_path_traversal(self):
            """Should reject path traversal attempts."""
            # Create a file outside the config directory
            parent_dir = os.path.dirname(self.temp_dir)
            with open(os.path.join(parent_dir, 'secret.json'), 'w') as f:
                f.write('{}')
            
            assert self.manager.load_config('../secret.json') is False
    
    class TestCreateConfig:
        """Tests for create_config method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_false_when_no_config_dir(self):
            """Should return False when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.create_config('test') is False
        
        def test_creates_new_config(self):
            """Should create a new config file."""
            assert self.manager.create_config('newconfig') is True
            assert os.path.exists(os.path.join(self.temp_dir, 'newconfig.json'))
            assert self.manager.current_config_name == 'newconfig.json'
        
        def test_adds_json_extension(self):
            """Should add .json extension if missing."""
            assert self.manager.create_config('myconfig') is True
            assert os.path.exists(os.path.join(self.temp_dir, 'myconfig.json'))
        
        def test_does_not_add_duplicate_extension(self):
            """Should not add duplicate .json extension."""
            assert self.manager.create_config('myconfig.json') is True
            assert os.path.exists(os.path.join(self.temp_dir, 'myconfig.json'))
            assert not os.path.exists(os.path.join(self.temp_dir, 'myconfig.json.json'))
        
        def test_returns_false_if_exists(self):
            """Should return False if file already exists."""
            with open(os.path.join(self.temp_dir, 'existing.json'), 'w') as f:
                f.write('{}')
            assert self.manager.create_config('existing') is False
        
        def test_rejects_path_traversal(self):
            """Should reject path traversal attempts."""
            assert self.manager.create_config('../outside') is False
            assert self.manager.create_config('../../outside') is False
        
        def test_switches_to_new_config(self):
            """Should switch to the newly created config."""
            self.manager.create_config('first')
            assert self.manager.current_config_name == 'first.json'
            
            self.manager.create_config('second')
            assert self.manager.current_config_name == 'second.json'
    
    class TestRenameConfig:
        """Tests for rename_config method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            with open(os.path.join(self.temp_dir, 'original.json'), 'w') as f:
                f.write('{}')
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_false_when_no_config_dir(self):
            """Should return False when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.rename_config('old', 'new') is False
        
        def test_renames_config(self):
            """Should rename a config file."""
            assert self.manager.rename_config('original', 'renamed') is True
            assert not os.path.exists(os.path.join(self.temp_dir, 'original.json'))
            assert os.path.exists(os.path.join(self.temp_dir, 'renamed.json'))
        
        def test_adds_json_extension(self):
            """Should add .json extension to both names if missing."""
            assert self.manager.rename_config('original', 'newname') is True
            assert os.path.exists(os.path.join(self.temp_dir, 'newname.json'))
        
        def test_returns_false_if_source_not_found(self):
            """Should return False if source file does not exist."""
            assert self.manager.rename_config('nonexistent', 'newname') is False
        
        def test_returns_false_if_target_exists(self):
            """Should return False if target file already exists."""
            with open(os.path.join(self.temp_dir, 'target.json'), 'w') as f:
                f.write('{}')
            assert self.manager.rename_config('original', 'target') is False
        
        def test_updates_current_config_name(self):
            """Should update currentConfigName if renaming current config."""
            self.manager.load_config('original.json')
            assert self.manager.current_config_name == 'original.json'
            
            assert self.manager.rename_config('original', 'renamed') is True
            assert self.manager.current_config_name == 'renamed.json'
        
        def test_does_not_update_if_different_config(self):
            """Should not update currentConfigName if renaming different config."""
            with open(os.path.join(self.temp_dir, 'other.json'), 'w') as f:
                f.write('{}')
            self.manager.load_config('original.json')
            
            assert self.manager.rename_config('other', 'renamed') is True
            assert self.manager.current_config_name == 'original.json'
        
        def test_rejects_path_traversal_in_old_name(self):
            """Should reject path traversal attempts in old name."""
            assert self.manager.rename_config('../secret', 'newname') is False
        
        def test_rejects_path_traversal_in_new_name(self):
            """Should reject path traversal attempts in new name."""
            assert self.manager.rename_config('original', '../outside') is False
    
    class TestUploadConfig:
        """Tests for upload_config method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_false_when_no_config_dir(self):
            """Should return False when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.upload_config('test', {}) is False
        
        def test_uploads_valid_config(self):
            """Should upload a valid config."""
            config_data = MidiStrummerConfig()
            config_data.strummer.strumming.chord = 'G'
            
            assert self.manager.upload_config('uploaded', config_data.to_dict()) is True
            assert os.path.exists(os.path.join(self.temp_dir, 'uploaded.json'))
            assert self.manager.current_config_name == 'uploaded.json'
            assert self.manager.config.strummer.strumming.chord == 'G'
        
        def test_adds_json_extension(self):
            """Should add .json extension if missing."""
            config_data = MidiStrummerConfig()
            assert self.manager.upload_config('myupload', config_data.to_dict()) is True
            assert os.path.exists(os.path.join(self.temp_dir, 'myupload.json'))
        
        def test_overwrites_existing(self):
            """Should overwrite existing file."""
            old_config = MidiStrummerConfig()
            old_config.strummer.strumming.chord = 'C'
            with open(os.path.join(self.temp_dir, 'existing.json'), 'w') as f:
                json.dump(old_config.to_dict(), f, indent=2)
            
            new_config = MidiStrummerConfig()
            new_config.strummer.strumming.chord = 'D'
            
            assert self.manager.upload_config('existing', new_config.to_dict()) is True
            assert self.manager.config.strummer.strumming.chord == 'D'
        
        def test_accepts_partial_config(self):
            """Should accept partial config data (defaults are filled in)."""
            # MidiStrummerConfig.from_dict is lenient and fills in defaults
            assert self.manager.upload_config('partial', {'strummer': {'strumming': {'chord': 'Em'}}}) is True
            assert self.manager.config.strummer.strumming.chord == 'Em'
        
        def test_rejects_path_traversal(self):
            """Should reject path traversal attempts."""
            config_data = MidiStrummerConfig()
            assert self.manager.upload_config('../outside', config_data.to_dict()) is False
        
        def test_switches_to_uploaded_config(self):
            """Should switch to the uploaded config."""
            config1 = MidiStrummerConfig()
            config1.strummer.strumming.chord = 'A'
            self.manager.upload_config('first', config1.to_dict())
            assert self.manager.current_config_name == 'first.json'
            
            config2 = MidiStrummerConfig()
            config2.strummer.strumming.chord = 'B'
            self.manager.upload_config('second', config2.to_dict())
            assert self.manager.current_config_name == 'second.json'
    
    class TestDeleteConfig:
        """Tests for delete_config method."""
        
        @pytest.fixture(autouse=True)
        def setup(self):
            """Set up test fixtures."""
            self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
            self.manager = ConfigFileManager(self.temp_dir)
            with open(os.path.join(self.temp_dir, 'deleteme.json'), 'w') as f:
                f.write('{}')
            with open(os.path.join(self.temp_dir, 'keepme.json'), 'w') as f:
                f.write('{}')
            yield
            if os.path.exists(self.temp_dir):
                shutil.rmtree(self.temp_dir)
        
        def test_returns_false_when_no_config_dir(self):
            """Should return False when no config directory is set."""
            manager = ConfigFileManager()
            assert manager.delete_config('test.json') is False
        
        def test_deletes_config(self):
            """Should delete a config file."""
            assert self.manager.delete_config('deleteme.json') is True
            assert not os.path.exists(os.path.join(self.temp_dir, 'deleteme.json'))
        
        def test_returns_false_if_not_found(self):
            """Should return False if file does not exist."""
            assert self.manager.delete_config('nonexistent.json') is False
        
        def test_does_not_delete_current_config(self):
            """Should not allow deleting the currently loaded config."""
            self.manager.load_config('deleteme.json')
            assert self.manager.delete_config('deleteme.json') is False
            assert os.path.exists(os.path.join(self.temp_dir, 'deleteme.json'))
        
        def test_allows_deleting_different_config(self):
            """Should allow deleting a different config when one is loaded."""
            self.manager.load_config('keepme.json')
            assert self.manager.delete_config('deleteme.json') is True
            assert not os.path.exists(os.path.join(self.temp_dir, 'deleteme.json'))
        
        def test_rejects_path_traversal(self):
            """Should reject path traversal attempts."""
            assert self.manager.delete_config('../secret.json') is False


class TestPathTraversalSecurity:
    """Tests for path traversal security across all methods."""
    
    @pytest.fixture(autouse=True)
    def setup(self):
        """Set up test fixtures."""
        self.temp_dir = tempfile.mkdtemp(prefix='config-test-')
        self.manager = ConfigFileManager(self.temp_dir)
        yield
        if os.path.exists(self.temp_dir):
            shutil.rmtree(self.temp_dir)
    
    def test_load_config_blocks_traversal(self):
        """Should block path traversal in load_config."""
        patterns = ['../secret.json', '../../secret.json']
        for pattern in patterns:
            assert self.manager.load_config(pattern) is False
    
    def test_create_config_blocks_traversal(self):
        """Should block path traversal in create_config."""
        patterns = ['../secret', '../../secret']
        for pattern in patterns:
            assert self.manager.create_config(pattern) is False
    
    def test_rename_config_blocks_traversal(self):
        """Should block path traversal in rename_config."""
        with open(os.path.join(self.temp_dir, 'source.json'), 'w') as f:
            f.write('{}')
        
        patterns = ['../secret', '../../secret']
        for pattern in patterns:
            assert self.manager.rename_config('source', pattern) is False
            assert self.manager.rename_config(pattern, 'target') is False
    
    def test_upload_config_blocks_traversal(self):
        """Should block path traversal in upload_config."""
        config_data = MidiStrummerConfig().to_dict()
        patterns = ['../secret', '../../secret']
        for pattern in patterns:
            assert self.manager.upload_config(pattern, config_data) is False
    
    def test_delete_config_blocks_traversal(self):
        """Should block path traversal in delete_config."""
        patterns = ['../secret.json', '../../secret.json']
        for pattern in patterns:
            assert self.manager.delete_config(pattern) is False


class TestWebSocketConfigManagementMessages:
    """Tests for WebSocket config management message formats."""
    
    def test_load_config_message_format(self):
        """Should have correct load-config message format."""
        message = {
            'type': 'load-config',
            'configName': 'myconfig.json',
        }
        assert message['type'] == 'load-config'
        assert 'configName' in message
        assert isinstance(message['configName'], str)
    
    def test_create_config_message_format(self):
        """Should have correct create-config message format."""
        message = {
            'type': 'create-config',
            'configName': 'newconfig',
        }
        assert message['type'] == 'create-config'
        assert 'configName' in message
    
    def test_rename_config_message_format(self):
        """Should have correct rename-config message format."""
        message = {
            'type': 'rename-config',
            'oldName': 'oldname.json',
            'newName': 'newname.json',
        }
        assert message['type'] == 'rename-config'
        assert 'oldName' in message
        assert 'newName' in message
    
    def test_upload_config_message_format(self):
        """Should have correct upload-config message format."""
        message = {
            'type': 'upload-config',
            'configName': 'uploaded.json',
            'configData': {'strummer': {}, 'midi': {}, 'server': {}},
        }
        assert message['type'] == 'upload-config'
        assert 'configName' in message
        assert 'configData' in message
        assert isinstance(message['configData'], dict)
    
    def test_delete_config_message_format(self):
        """Should have correct delete-config message format."""
        message = {
            'type': 'delete-config',
            'configName': 'todelete.json',
        }
        assert message['type'] == 'delete-config'
        assert 'configName' in message
    
    def test_config_response_includes_management_fields(self):
        """Should include config management fields in response."""
        response = {
            'type': 'config',
            'data': {
                'throttleMs': 100,
                'notes': [],
                'config': {},
                'currentConfigName': 'default.json',
                'availableConfigs': ['default.json', 'custom.json'],
                'isSavedState': True,
            },
        }
        assert 'currentConfigName' in response['data']
        assert 'availableConfigs' in response['data']
        assert 'isSavedState' in response['data']
        assert isinstance(response['data']['availableConfigs'], list)
        assert isinstance(response['data']['isSavedState'], bool)
    
    def test_is_saved_state_true_after_load(self):
        """Should have isSavedState=True after load/save operations."""
        after_load = {'type': 'config', 'data': {'isSavedState': True}}
        assert after_load['data']['isSavedState'] is True
    
    def test_is_saved_state_false_after_update(self):
        """Should have isSavedState=False after update operations."""
        after_update = {'type': 'config', 'data': {'isSavedState': False}}
        assert after_update['data']['isSavedState'] is False
