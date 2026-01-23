#!/usr/bin/env python3
"""
Event Viewer CLI

A simple wrapper script to run blankslate's tablet-events CLI tool.
This allows running the event viewer from within the sketchatone repo.

Usage:
    python -m sketchatone.cli.event_viewer
    python -m sketchatone.cli.event_viewer -c path/to/config.json
    python -m sketchatone.cli.event_viewer -c path/to/config.json --live
    python -m sketchatone.cli.event_viewer -c path/to/config.json --mock
"""

import argparse
import subprocess
import sys
import os

# Default config directory (relative to python/ directory)
DEFAULT_CONFIG_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '..', 'public', 'configs')


def resolve_config_path(config_arg: str | None, default_dir: str = DEFAULT_CONFIG_DIR) -> str:
    """
    Resolve config path - if it's a directory or None, search for matching config.
    Uses blankslate's find_config_for_device.

    Args:
        config_arg: Config path argument (file, directory, or None)
        default_dir: Default directory to search if config_arg is None

    Returns:
        Resolved config file path

    Raises:
        SystemExit: If no matching config is found
    """
    try:
        from blankslate.utils.finddevice import find_config_for_device
    except ImportError:
        print("Error: blankslate package not found.")
        print("Make sure blankslate is installed: pip install -e ../blankslate/python")
        sys.exit(1)

    # If no config provided, use default directory
    if config_arg is None:
        search_dir = os.path.abspath(default_dir)
        found_config = find_config_for_device(search_dir)
        if found_config:
            return found_config
        else:
            print(f'Error: No matching tablet config found in: {search_dir}')
            sys.exit(1)

    # If it's a file with .json extension, use it directly
    if config_arg.endswith('.json'):
        if not os.path.exists(config_arg):
            print(f'Error: Config file not found: {config_arg}')
            sys.exit(1)
        return config_arg

    config_path = os.path.abspath(config_arg)

    # If it's a directory, search for matching config
    if os.path.isdir(config_path):
        found_config = find_config_for_device(config_path)
        if found_config:
            return found_config
        else:
            print(f'Error: No matching tablet config found in: {config_path}')
            sys.exit(1)

    # If path doesn't exist and has no extension, try default directory
    if not os.path.exists(config_path) and not os.path.splitext(config_arg)[1]:
        search_dir = os.path.abspath(default_dir)
        found_config = find_config_for_device(search_dir)
        if found_config:
            return found_config
        else:
            print(f'Error: No matching tablet config found in: {search_dir}')
            sys.exit(1)

    # Otherwise treat as file path
    if not os.path.exists(config_arg):
        print(f'Error: Config file not found: {config_arg}')
        sys.exit(1)
    return config_arg


def main():
    parser = argparse.ArgumentParser(
        description='View tablet events using blankslate event viewer',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
    # Auto-detect tablet from default config directory
    python -m sketchatone.cli.event_viewer

    # Auto-detect tablet from specific directory
    python -m sketchatone.cli.event_viewer -c ./configs/

    # Basic usage with tablet config
    python -m sketchatone.cli.event_viewer -c public/configs/xpdeco640.json

    # Live dashboard mode
    python -m sketchatone.cli.event_viewer -c public/configs/xpdeco640.json --live

    # Use mock data for testing
    python -m sketchatone.cli.event_viewer -c public/configs/xpdeco640.json --mock

    # Show raw byte data
    python -m sketchatone.cli.event_viewer -c public/configs/xpdeco640.json --raw
"""
    )

    parser.add_argument(
        '-c', '--config',
        help='Path to tablet config JSON file or directory (auto-detects from ../public/configs if not provided)'
    )
    parser.add_argument(
        '-l', '--live',
        action='store_true',
        help='Live dashboard mode (updates in place)'
    )
    parser.add_argument(
        '-m', '--mock',
        action='store_true',
        help='Use mock data instead of real device'
    )
    parser.add_argument(
        '-r', '--raw',
        action='store_true',
        help='Show raw byte data'
    )
    parser.add_argument(
        '--compact',
        action='store_true',
        help='Use compact single-line output'
    )

    args = parser.parse_args()

    # Resolve tablet config path (handles auto-detection from directory)
    config_path = resolve_config_path(args.config)

    # Build the npx command to run blankslate's tablet-events
    cmd = ['npx', 'tablet-events', '-c', config_path]

    if args.live:
        cmd.append('--live')
    if args.mock:
        cmd.append('--mock')
    if args.raw:
        cmd.append('--raw')
    if args.compact:
        cmd.append('--compact')

    # Find the project root (where package.json is)
    # Start from the script location and go up
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.dirname(os.path.dirname(os.path.dirname(script_dir)))
    
    try:
        # Run the command from the project root
        result = subprocess.run(
            cmd,
            cwd=project_root,
            check=False  # Don't raise on non-zero exit
        )
        sys.exit(result.returncode)
    except KeyboardInterrupt:
        print('\nInterrupted')
        sys.exit(0)
    except FileNotFoundError:
        print('Error: npx not found. Make sure Node.js is installed and in your PATH.')
        sys.exit(1)
    except Exception as e:
        print(f'Error: {e}')
        sys.exit(1)


if __name__ == '__main__':
    main()
