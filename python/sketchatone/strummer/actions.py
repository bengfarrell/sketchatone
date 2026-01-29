"""
Action handlers for stylus button and other input actions.
Provides a centralized way to handle user actions like toggling features.

Ported from midi-strummer/server/actions.py
"""

from typing import Dict, Any, Optional, Union, List, Callable

from ..utils.event_emitter import EventEmitter
from ..models.note import Note, NoteObject
from ..models.strummer_features import CHORD_PROGRESSION_PRESETS


class ChordProgressionState:
    """
    Manages the state of a chord progression.
    Tracks the current progression name, chords, and index.
    """
    
    def __init__(self):
        self.progression_name: Optional[str] = None
        self.chords: List[str] = []
        self.current_index: int = 0
    
    def load_progression(self, name: str) -> bool:
        """
        Load a chord progression by name.
        
        Args:
            name: Progression name (e.g., "c-major-pop")
            
        Returns:
            True if progression was loaded, False if not found
        """
        if name in CHORD_PROGRESSION_PRESETS:
            self.progression_name = name
            self.chords = list(CHORD_PROGRESSION_PRESETS[name])
            self.current_index = 0
            print(f"[PROGRESSION] Loaded '{name}' with {len(self.chords)} chords")
            return True
        else:
            print(f"[PROGRESSION] Error: Unknown progression '{name}'")
            return False
    
    def set_index(self, index: int) -> int:
        """
        Set the current index (wraps around).
        
        Args:
            index: Index to set
            
        Returns:
            Actual index after wrapping
        """
        if self.chords:
            self.current_index = index % len(self.chords)
        return self.current_index
    
    def increment_index(self, amount: int = 1) -> int:
        """
        Increment the current index by amount (wraps around).
        
        Args:
            amount: Amount to increment (can be negative)
            
        Returns:
            New index after incrementing
        """
        if self.chords:
            self.current_index = (self.current_index + amount) % len(self.chords)
        return self.current_index
    
    def get_current_chord(self) -> Optional[str]:
        """
        Get the current chord in the progression.
        
        Returns:
            Current chord notation, or None if no progression loaded
        """
        if self.chords and 0 <= self.current_index < len(self.chords):
            return self.chords[self.current_index]
        return None


class Actions(EventEmitter):
    """
    Handles various user actions that can be triggered by stylus buttons or other inputs.
    
    Actions are executed through the execute() method by passing an action definition.
    Actions can be specified as:
    - A string: "toggle-repeater"
    - An array: ["transpose", 12] where first item is action name, rest are parameters
    - Nested arrays: ["set-strum-notes", ["C4", "E4", "G4"]] for complex parameters
    - Chord notation: ["set-strum-chord", "Cmaj7", 3] for chord-based note setting
    
    Events emitted:
        - 'config_changed': When an action modifies the configuration
    """
    
    def __init__(self, config: Any, strummer: Any = None):
        """
        Initialize Actions with a configuration instance.
        
        Args:
            config: Configuration instance that will be modified by actions
            strummer: Optional Strummer instance for setting notes
        """
        super().__init__()
        self.config = config
        self.strummer = strummer
        
        # Map action names to handler methods
        self._action_handlers: Dict[str, Callable] = {
            'toggle-repeater': self.toggle_repeater,
            'toggle-transpose': self.toggle_transpose,
            'transpose': self.transpose,
            'set-strum-notes': self.set_strum_notes,
            'set-strum-chord': self.set_strum_chord,
            'set-chord-in-progression': self.set_chord_in_progression,
            'increment-chord-in-progression': self.increment_chord_in_progression,
        }
        
        # Chord progression state
        self.progression_state = ChordProgressionState()
    
    def execute(self, action_def: Union[str, List, None], context: Optional[Dict[str, Any]] = None) -> bool:
        """
        Execute an action by definition.
        
        Args:
            action_def: Action definition - can be:
                       - String: "toggle-repeater"
                       - List: ["transpose", 12] (action name + parameters)
                       - Nested list: ["set-strum-notes", ["C4", "E4", "G4"]]
                       - None/empty: no action
            context: Optional context data for the action (e.g., which button triggered it)
            
        Returns:
            True if action was executed successfully, False if action not found or invalid
        """
        if action_def is None or action_def == 'none' or action_def == '':
            return False
        
        # Parse action definition
        if isinstance(action_def, str):
            action_name = action_def
            params = []
        elif isinstance(action_def, list) and len(action_def) > 0:
            action_name = action_def[0]
            params = action_def[1:] if len(action_def) > 1 else []
        else:
            print(f"[ACTIONS] Warning: Invalid action definition: {action_def}")
            return False
        
        # Execute the action
        handler = self._action_handlers.get(action_name)
        if handler:
            handler(params, context or {})
            return True
        else:
            print(f"[ACTIONS] Warning: Unknown action '{action_name}'")
            return False
    
    def toggle_repeater(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Toggle the note repeater feature on/off.
        
        Args:
            params: Optional parameters (not used for this action)
            context: Context data (e.g., which button triggered the action)
        """
        # Get current state from config
        note_repeater = getattr(self.config, 'note_repeater', None)
        if note_repeater is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                note_repeater = self.config.get('note_repeater') or self.config.get('noteRepeater')
            else:
                note_repeater_cfg = getattr(self.config, 'get', lambda k, d: d)('noteRepeater', {})
                note_repeater = note_repeater_cfg if isinstance(note_repeater_cfg, dict) else None

        # Get current active state
        if note_repeater is None:
            current_active = False
        elif isinstance(note_repeater, dict):
            current_active = note_repeater.get('active', False)
        else:
            current_active = note_repeater.active

        new_state = not current_active

        # Update config
        if note_repeater is not None and hasattr(note_repeater, 'active'):
            # Direct object with active attribute
            note_repeater.active = new_state
        elif isinstance(self.config, dict):
            # Dictionary config - update the note_repeater object directly
            if 'note_repeater' in self.config and hasattr(self.config['note_repeater'], 'active'):
                self.config['note_repeater'].active = new_state
            elif 'noteRepeater' in self.config and hasattr(self.config['noteRepeater'], 'active'):
                self.config['noteRepeater'].active = new_state
        elif hasattr(self.config, 'set'):
            self.config.set('noteRepeater.active', new_state)
        
        # Log which button triggered the action if available
        button = context.get('button', 'Unknown')
        print(f"[ACTIONS] {button} button toggled repeater: {'ON' if new_state else 'OFF'}")
        
        # Emit config changed event
        self.emit('config_changed')

    def toggle_transpose(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Toggle transpose on/off using the configured semitones value.
        Unlike the 'transpose' action which requires a semitones parameter,
        this action uses the semitones value already configured in transpose.semitones.

        Args:
            params: Optional parameters (not used for this action)
            context: Context data (e.g., which button triggered the action)
        """
        # Get current state from config
        transpose_cfg = getattr(self.config, 'transpose', None)
        if transpose_cfg is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                transpose_cfg = self.config.get('transpose')
            else:
                transpose_dict = getattr(self.config, 'get', lambda k, d: d)('transpose', {})
                transpose_cfg = transpose_dict if isinstance(transpose_dict, dict) else None

        # Get current values
        if transpose_cfg is None:
            current_active = False
            configured_semitones = 12
        elif isinstance(transpose_cfg, dict):
            current_active = transpose_cfg.get('active', False)
            configured_semitones = transpose_cfg.get('semitones', 12)
        else:
            current_active = transpose_cfg.active
            configured_semitones = transpose_cfg.semitones

        new_state = not current_active

        # Update config - keep the semitones value, just toggle active
        if transpose_cfg is not None and hasattr(transpose_cfg, 'active'):
            transpose_cfg.active = new_state
        elif isinstance(self.config, dict) and 'transpose' in self.config and hasattr(self.config['transpose'], 'active'):
            self.config['transpose'].active = new_state
        elif hasattr(self.config, 'set'):
            self.config.set('transpose.active', new_state)

        # Log which button triggered the action if available
        button = context.get('button', 'Unknown')
        if new_state:
            sign = '+' if configured_semitones > 0 else ''
            print(f"[ACTIONS] {button} button enabled transpose: {sign}{configured_semitones} semitones")
        else:
            print(f"[ACTIONS] {button} button disabled transpose")

        # Emit config changed event
        self.emit('config_changed')

    def transpose(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Toggle transpose on/off with specified semitones.

        Args:
            params: Required parameters:
                   - params[0] (int): Semitones to transpose (e.g., 12 for one octave up)
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) == 0 or not isinstance(params[0], (int, float)):
            print(f"[ACTIONS] Error: transpose action requires semitones parameter")
            return

        semitones = int(params[0])
        button = context.get('button', 'Unknown')

        # Get current transpose state
        transpose_cfg = getattr(self.config, 'transpose', None)
        if transpose_cfg is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                transpose_cfg = self.config.get('transpose')
            else:
                transpose_dict = getattr(self.config, 'get', lambda k, d: d)('transpose', {})
                transpose_cfg = transpose_dict if isinstance(transpose_dict, dict) else None

        # Get current values
        if transpose_cfg is None:
            current_active = False
            current_semitones = 0
        elif isinstance(transpose_cfg, dict):
            current_active = transpose_cfg.get('active', False)
            current_semitones = transpose_cfg.get('semitones', 0)
        else:
            current_active = transpose_cfg.active
            current_semitones = transpose_cfg.semitones

        # Toggle: if currently active with same semitones, turn off; otherwise turn on with new semitones
        if current_active and current_semitones == semitones:
            # Turn off
            if transpose_cfg is not None and hasattr(transpose_cfg, 'active'):
                transpose_cfg.active = False
                transpose_cfg.semitones = 0
            elif isinstance(self.config, dict) and 'transpose' in self.config and hasattr(self.config['transpose'], 'active'):
                self.config['transpose'].active = False
                self.config['transpose'].semitones = 0
            elif hasattr(self.config, 'set'):
                self.config.set('transpose.active', False)
                self.config.set('transpose.semitones', 0)
            print(f"[ACTIONS] {button} button disabled transpose")
        else:
            # Turn on with specified semitones
            if transpose_cfg is not None and hasattr(transpose_cfg, 'active'):
                transpose_cfg.active = True
                transpose_cfg.semitones = semitones
            elif isinstance(self.config, dict) and 'transpose' in self.config and hasattr(self.config['transpose'], 'active'):
                self.config['transpose'].active = True
                self.config['transpose'].semitones = semitones
            elif hasattr(self.config, 'set'):
                self.config.set('transpose.active', True)
                self.config.set('transpose.semitones', semitones)
            print(f"[ACTIONS] {button} button enabled transpose: {semitones:+d} semitones")

        # Emit config changed event
        self.emit('config_changed')
    
    def get_transpose_semitones(self) -> int:
        """
        Get the current transpose semitones.

        Returns:
            Current transpose semitones (0 if transpose is not active)
        """
        transpose_cfg = getattr(self.config, 'transpose', None)
        if transpose_cfg is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                transpose_cfg = self.config.get('transpose')
            else:
                transpose_dict = getattr(self.config, 'get', lambda k, d: d)('transpose', {})
                transpose_cfg = transpose_dict if isinstance(transpose_dict, dict) else None

        if transpose_cfg is None:
            return 0
        elif isinstance(transpose_cfg, dict):
            if transpose_cfg.get('active', False):
                return transpose_cfg.get('semitones', 0)
            return 0

        if transpose_cfg.active:
            return transpose_cfg.semitones
        return 0

    def is_transpose_active(self) -> bool:
        """
        Check if transpose is currently active.

        Returns:
            True if transpose is active, False otherwise
        """
        transpose_cfg = getattr(self.config, 'transpose', None)
        if transpose_cfg is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                transpose_cfg = self.config.get('transpose')
            else:
                transpose_dict = getattr(self.config, 'get', lambda k, d: d)('transpose', {})
                transpose_cfg = transpose_dict if isinstance(transpose_dict, dict) else None

        if transpose_cfg is None:
            return False
        elif isinstance(transpose_cfg, dict):
            return transpose_cfg.get('active', False)
        return transpose_cfg.active
    
    def is_repeater_active(self) -> bool:
        """
        Check if note repeater is currently active.

        Returns:
            True if repeater is active, False otherwise
        """
        note_repeater = getattr(self.config, 'note_repeater', None)
        if note_repeater is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                note_repeater = self.config.get('note_repeater') or self.config.get('noteRepeater')
            else:
                note_repeater_cfg = getattr(self.config, 'get', lambda k, d: d)('noteRepeater', {})
                note_repeater = note_repeater_cfg if isinstance(note_repeater_cfg, dict) else None

        if note_repeater is None:
            return False
        elif isinstance(note_repeater, dict):
            return note_repeater.get('active', False)
        return note_repeater.active
    
    def get_repeater_config(self) -> Dict[str, Any]:
        """
        Get the note repeater configuration.

        Returns:
            Dictionary with active, pressureMultiplier, frequencyMultiplier
        """
        note_repeater = getattr(self.config, 'note_repeater', None)
        if note_repeater is None:
            # Try dictionary-style access (supports both snake_case and camelCase keys)
            if isinstance(self.config, dict):
                note_repeater = self.config.get('note_repeater') or self.config.get('noteRepeater')
            else:
                note_repeater_cfg = getattr(self.config, 'get', lambda k, d: d)('noteRepeater', {})
                note_repeater = note_repeater_cfg if isinstance(note_repeater_cfg, dict) else None

        if note_repeater is None:
            return {'active': False, 'pressureMultiplier': 1.0, 'frequencyMultiplier': 1.0}
        elif isinstance(note_repeater, dict):
            return {
                'active': note_repeater.get('active', False),
                'pressureMultiplier': note_repeater.get('pressureMultiplier', note_repeater.get('pressure_multiplier', 1.0)),
                'frequencyMultiplier': note_repeater.get('frequencyMultiplier', note_repeater.get('frequency_multiplier', 1.0))
            }

        return {
            'active': note_repeater.active,
            'pressureMultiplier': note_repeater.pressure_multiplier,
            'frequencyMultiplier': note_repeater.frequency_multiplier
        }
    
    def set_strum_notes(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Set the strumming notes to a specific set of notes.
        
        Args:
            params: Required parameters:
                   - params[0] (list): Array of note strings in notation format (e.g., ["C4", "E4", "G4"])
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) == 0 or not isinstance(params[0], list):
            print(f"[ACTIONS] Error: set-strum-notes action requires an array of note strings")
            return
        
        note_strings = params[0]
        
        # Validate that all items are strings
        if not all(isinstance(n, str) for n in note_strings):
            print(f"[ACTIONS] Error: set-strum-notes requires all notes to be strings")
            return
        
        if len(note_strings) == 0:
            print(f"[ACTIONS] Error: set-strum-notes requires at least one note")
            return
        
        if self.strummer is None:
            print(f"[ACTIONS] Error: No strummer instance available")
            return
        
        try:
            # Parse note strings into Note objects
            notes = [Note.parse_notation(n) for n in note_strings]
            
            # Get note spread configuration
            lower_spread = getattr(self.config, 'lower_spread', 0)
            upper_spread = getattr(self.config, 'upper_spread', 0)
            
            # Apply note spread and set strummer notes
            self.strummer.notes = Note.fill_note_spread(notes, lower_spread, upper_spread)
            
            # Log the action
            button = context.get('button', 'Unknown')
            note_names = ', '.join(note_strings)
            print(f"[ACTIONS] {button} button set strum notes: [{note_names}]")
            
            # Note: broadcast happens automatically via strummer's notes_changed event
            
        except Exception as e:
            print(f"[ACTIONS] Error parsing notes: {e}")
    
    def set_strum_chord(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Set the strumming notes using chord notation.
        
        Args:
            params: Required parameters:
                   - params[0] (str): Chord notation (e.g., "C", "Gm", "Am7", "Fmaj7")
                   - params[1] (int, optional): Octave (default: 4)
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) == 0 or not isinstance(params[0], str):
            print(f"[ACTIONS] Error: set-strum-chord action requires chord notation string")
            return
        
        chord_notation = params[0]
        octave = 4  # Default octave
        
        # Check for optional octave parameter
        if len(params) > 1 and isinstance(params[1], (int, float)):
            octave = int(params[1])
        
        if self.strummer is None:
            print(f"[ACTIONS] Error: No strummer instance available")
            return
        
        try:
            # Parse chord into notes
            notes = Note.parse_chord(chord_notation, octave)
            
            if not notes:
                print(f"[ACTIONS] Error: Failed to parse chord '{chord_notation}'")
                return
            
            # Get note spread configuration
            lower_spread = getattr(self.config, 'lower_spread', 0)
            upper_spread = getattr(self.config, 'upper_spread', 0)
            
            # Apply note spread and set strummer notes
            self.strummer.notes = Note.fill_note_spread(notes, lower_spread, upper_spread)
            
            # Log the action
            button = context.get('button', 'Unknown')
            note_names = ', '.join([f"{n.notation}{n.octave}" for n in notes])
            print(f"[ACTIONS] {button} button set strum chord: {chord_notation} [{note_names}]")
            
            # Note: broadcast happens automatically via strummer's notes_changed event
            
        except Exception as e:
            print(f"[ACTIONS] Error parsing chord: {e}")
    
    def set_chord_in_progression(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Set the chord progression to a specific index and apply that chord.
        
        Args:
            params: Required parameters:
                   - params[0] (str): Progression name (e.g., "c-major-pop")
                   - params[1] (int): Index to set (wraps around if out of range)
                   - params[2] (int, optional): Octave (default: 4)
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) < 2:
            print(f"[ACTIONS] Error: set-chord-in-progression requires progression name and index")
            return
        
        if not isinstance(params[0], str):
            print(f"[ACTIONS] Error: First parameter must be progression name (string)")
            return
        
        if not isinstance(params[1], (int, float)):
            print(f"[ACTIONS] Error: Second parameter must be index (integer)")
            return
        
        progression_name = params[0]
        index = int(params[1])
        octave = 4  # Default octave
        
        # Check for optional octave parameter
        if len(params) > 2 and isinstance(params[2], (int, float)):
            octave = int(params[2])
        
        if self.strummer is None:
            print(f"[ACTIONS] Error: No strummer instance available")
            return
        
        # Load progression if different from current
        if self.progression_state.progression_name != progression_name:
            if not self.progression_state.load_progression(progression_name):
                return
        
        # Set the index
        actual_index = self.progression_state.set_index(index)
        chord_notation = self.progression_state.get_current_chord()
        
        if not chord_notation:
            print(f"[ACTIONS] Error: Could not get chord from progression")
            return
        
        try:
            # Parse chord into notes
            notes = Note.parse_chord(chord_notation, octave)
            
            if not notes:
                print(f"[ACTIONS] Error: Failed to parse chord '{chord_notation}'")
                return
            
            # Get note spread configuration
            lower_spread = getattr(self.config, 'lower_spread', 0)
            upper_spread = getattr(self.config, 'upper_spread', 0)
            
            # Apply note spread and set strummer notes
            self.strummer.notes = Note.fill_note_spread(notes, lower_spread, upper_spread)
            
            # Log the action
            button = context.get('button', 'Unknown')
            print(f"[ACTIONS] {button} button set progression '{progression_name}' to index {actual_index}: {chord_notation}")
            
            # Note: broadcast happens automatically via strummer's notes_changed event
            
        except Exception as e:
            print(f"[ACTIONS] Error setting chord in progression: {e}")
    
    def increment_chord_in_progression(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Increment the current chord progression index and apply that chord.
        
        Args:
            params: Required parameters:
                   - params[0] (str): Progression name (e.g., "c-major-pop")
                   - params[1] (int, optional): Amount to increment (default: 1, can be negative)
                   - params[2] (int, optional): Octave (default: 4)
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) < 1:
            print(f"[ACTIONS] Error: increment-chord-in-progression requires progression name")
            return
        
        if not isinstance(params[0], str):
            print(f"[ACTIONS] Error: First parameter must be progression name (string)")
            return
        
        progression_name = params[0]
        increment_amount = 1  # Default increment
        octave = 4  # Default octave
        
        # Check for optional increment amount parameter
        if len(params) > 1 and isinstance(params[1], (int, float)):
            increment_amount = int(params[1])
        
        # Check for optional octave parameter
        if len(params) > 2 and isinstance(params[2], (int, float)):
            octave = int(params[2])
        
        if self.strummer is None:
            print(f"[ACTIONS] Error: No strummer instance available")
            return
        
        # Load progression if different from current
        if self.progression_state.progression_name != progression_name:
            if not self.progression_state.load_progression(progression_name):
                return
        
        # Increment the index
        actual_index = self.progression_state.increment_index(increment_amount)
        chord_notation = self.progression_state.get_current_chord()
        
        if not chord_notation:
            print(f"[ACTIONS] Error: Could not get chord from progression")
            return
        
        try:
            # Parse chord into notes
            notes = Note.parse_chord(chord_notation, octave)
            
            if not notes:
                print(f"[ACTIONS] Error: Failed to parse chord '{chord_notation}'")
                return
            
            # Get note spread configuration
            lower_spread = getattr(self.config, 'lower_spread', 0)
            upper_spread = getattr(self.config, 'upper_spread', 0)
            
            # Apply note spread and set strummer notes
            self.strummer.notes = Note.fill_note_spread(notes, lower_spread, upper_spread)
            
            # Log the action
            button = context.get('button', 'Unknown')
            direction = "forward" if increment_amount > 0 else "backward"
            print(f"[ACTIONS] {button} button incremented progression '{progression_name}' {direction} by {abs(increment_amount)} to index {actual_index}: {chord_notation}")
            
            # Note: broadcast happens automatically via strummer's notes_changed event
            
        except Exception as e:
            print(f"[ACTIONS] Error incrementing chord in progression: {e}")
    
    def register_action(self, action_name: str, handler_func: Callable) -> None:
        """
        Register a custom action handler.
        
        Args:
            action_name: Name of the action
            handler_func: Function to call when action is executed
                         Should accept (params: List[Any], context: Dict[str, Any]) parameters
        """
        self._action_handlers[action_name] = handler_func
        print(f"[ACTIONS] Registered custom action: {action_name}")
    
    def get_available_actions(self) -> List[str]:
        """
        Get list of all available action names.
        
        Returns:
            List of action names that can be executed
        """
        return list(self._action_handlers.keys())
