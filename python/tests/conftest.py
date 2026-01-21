"""
Pytest configuration and shared fixtures

This file is automatically loaded by pytest and provides
fixtures that can be used across all test files.
"""

import pytest
import json
import os


@pytest.fixture
def fixtures_dir():
    """Path to test fixtures directory"""
    return os.path.join(os.path.dirname(__file__), 'fixtures')
