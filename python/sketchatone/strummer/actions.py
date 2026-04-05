"""
Action handlers for stylus button and other input actions.
Provides a centralized way to handle user actions like toggling features.

Ported from midi-strummer/server/actions.py
"""

from typing import Dict, Any, Optional, Union, List, Callable, TYPE_CHECKING

from ..utils.event_emitter import EventEmitter
from ..models.note import Note, NoteObject

if TYPE_CHECKING:
    from ..models.action_rules import ActionRulesConfig, TriggerType, ButtonId


class ChordProgressionState:
    """
    Manages the state of a chord progression.
    Tracks the current progression name, chords, and index.
    """

    def __init__(self, chord_progressions: Optional[Dict[str, List[str]]] = None):
        self.progression_name: Optional[str] = None
        self.chords: List[str] = []
        self.current_index: int = 0
        self.available_progressions = chord_progressions or {}

    def update_progressions(self, chord_progressions: Optional[Dict[str, List[str]]] = None) -> None:
        """
        Update available progressions (e.g., when config changes).

        Args:
            chord_progressions: Chord progressions from config
        """
        self.available_progressions = chord_progressions or {}

    def load_progression(self, name: str) -> bool:
        """
        Load a chord progression by name.
        
        Args:
            name: Progression name (e.g., "c-major-pop")
            
        Returns:
            True if progression was loaded, False if not found
        """
        if name in self.available_progressions:
            self.progression_name = name
            self.chords = list(self.available_progressions[name])
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

    def __init__(self, config: Any, strummer: Any = None, chord_progressions: Optional[Dict[str, List[str]]] = None):
        """
        Initialize Actions with a configuration instance.

        Args:
            config: Configuration instance that will be modified by actions
            strummer: Optional Strummer instance for setting notes
            chord_progressions: Optional chord progressions from config
        """
        super().__init__()
        self.config = config
        self.strummer = strummer
        self.chord_progressions = chord_progressions or {}

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
        self.progression_state = ChordProgressionState(self.chord_progressions)

        # Action rules configuration (set via set_action_rules_config)
        self._action_rules_config: Optional['ActionRulesConfig'] = None

        # Internal state for repeater and transpose (managed by actions, not config)
        self._repeater_state = {
            'active': False,
            'pressure_multiplier': 1.0,
            'frequency_multiplier': 1.0,
        }
        self._transpose_state = {
            'active': False,
            'semitones': 0,
        }

    @property
    def action_rules_config(self) -> Optional['ActionRulesConfig']:
        """Get the current action rules configuration"""
        return self._action_rules_config

    def set_action_rules_config(self, config: 'ActionRulesConfig') -> None:
        """
        Set the action rules configuration.

        Args:
            config: ActionRulesConfig instance to use for button-to-action mapping
        """
        self._action_rules_config = config

    def set_chord_progressions(self, chord_progressions: Dict[str, List[str]]) -> None:
        """
        Update chord progressions.
        This allows dynamically updating the available progressions.

        Args:
            chord_progressions: Chord progressions dictionary
        """
        self.chord_progressions = chord_progressions
        self.progression_state.update_progressions(chord_progressions)

    def handle_button_event(self, button_id: 'ButtonId', trigger: 'TriggerType') -> bool:
        """
        Handle a button event using the action rules configuration.

        Args:
            button_id: The button identifier (e.g., "button:primary", "button:1")
            trigger: The trigger type ('press', 'release', or 'hold')

        Returns:
            True if an action was executed, False otherwise
        """
        if not self._action_rules_config:
            print('[ACTIONS] No action rules config set, cannot handle button event')
            return False

        result = self._action_rules_config.get_rule_for_button_event(button_id, trigger)
        if result:
            return self.execute(result['action'], context={
                'button': button_id,
                'trigger': trigger,
                'rule_id': result['rule_id']
            })

        return False

    def execute_startup_rules(self) -> None:
        """
        Execute all startup rules defined in the action rules configuration.
        Called after initialization to set up initial state.
        """
        if not self._action_rules_config:
            return

        for rule in self._action_rules_config.startup_rules:
            print(f"[ACTIONS] Executing startup rule: {rule.name}")
            self.execute(rule.action, context={
                'button': 'startup',
                'rule_name': rule.name,
                'rule_id': rule.id,
                'is_startup': True
            })

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

        context = context or {}

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
            handler(params, context)

            # Emit action_executed event for UI feedback
            import time
            self.emit('action_executed', {
                'action': action_name,
                'params': params,
                'button': context.get('button'),
                'trigger': context.get('trigger'),
                'timestamp': int(time.time() * 1000),  # milliseconds
                'rule_id': context.get('rule_id'),
                'is_startup': context.get('is_startup', False),
            })

            return True
        else:
            print(f"[ACTIONS] Warning: Unknown action '{action_name}'")
            return False
    
    def toggle_repeater(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Toggle the note repeater feature on/off.

        Args:
            params: Optional parameters:
                   - params[0]: pressureMultiplier (float, default 1.0) - Multiplier for note velocity on repeats
                   - params[1]: frequencyMultiplier (float, default 1.0) - Multiplier for repeat frequency (higher = faster)
            context: Context data (e.g., which button triggered the action)
        """
        new_state = not self._repeater_state['active']

        # Parse optional parameters
        pressure_multiplier = float(params[0]) if len(params) > 0 and isinstance(params[0], (int, float)) else 1.0
        frequency_multiplier = float(params[1]) if len(params) > 1 and isinstance(params[1], (int, float)) else 1.0

        # Update internal state
        self._repeater_state['active'] = new_state
        if new_state:
            # Only update multipliers when turning on
            self._repeater_state['pressure_multiplier'] = pressure_multiplier
            self._repeater_state['frequency_multiplier'] = frequency_multiplier

        # Log which button triggered the action if available
        button = context.get('button', 'Unknown')
        if new_state:
            print(f"[ACTIONS] {button} button enabled repeater: pressure={pressure_multiplier}x, frequency={frequency_multiplier}x")
        else:
            print(f"[ACTIONS] {button} button disabled repeater")

        # Emit config changed event
        self.emit('config_changed')

    def toggle_transpose(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Toggle transpose on/off.

        Args:
            params: Optional parameters:
                   - params[0]: semitones (int, default 12) - Number of semitones to transpose
            context: Context data (e.g., which button triggered the action)
        """
        new_state = not self._transpose_state['active']

        # Parse optional semitones parameter
        semitones = int(params[0]) if len(params) > 0 and isinstance(params[0], (int, float)) else 12

        # Update internal state
        self._transpose_state['active'] = new_state
        if new_state:
            # Only update semitones when turning on
            self._transpose_state['semitones'] = semitones

        # Log which button triggered the action if available
        button = context.get('button', 'Unknown')
        if new_state:
            sign = '+' if semitones > 0 else ''
            print(f"[ACTIONS] {button} button enabled transpose: {sign}{semitones} semitones")
        else:
            print(f"[ACTIONS] {button} button disabled transpose")

        # Emit config changed event
        self.emit('config_changed')

    def transpose(self, params: List[Any], context: Dict[str, Any]) -> None:
        """
        Add semitones to the current transpose value (cumulative).
        Each press adds the specified semitones to the current transpose amount.
        Transpose is automatically enabled when non-zero, disabled when zero.

        Args:
            params: Required parameters:
                   - params[0] (int): Semitones to add (can be negative)
            context: Context data (e.g., which button triggered the action)
        """
        if len(params) == 0 or not isinstance(params[0], (int, float)):
            print(f"[ACTIONS] Error: transpose action requires semitones parameter")
            return

        semitones_to_add = int(params[0])
        button = context.get('button', 'Unknown')

        # Add to current semitones (cumulative)
        new_semitones = self._transpose_state['semitones'] + semitones_to_add
        self._transpose_state['semitones'] = new_semitones
        # Active when non-zero
        self._transpose_state['active'] = new_semitones != 0

        if new_semitones == 0:
            print(f"[ACTIONS] {button} button reset transpose to 0")
        else:
            print(f"[ACTIONS] {button} button transposed {semitones_to_add:+d} → total: {new_semitones:+d} semitones")

        # Emit config changed event
        self.emit('config_changed')

    def get_transpose_semitones(self) -> int:
        """
        Get the current transpose semitones.

        Returns:
            Current transpose semitones (0 if transpose is not active)
        """
        return self._transpose_state['semitones'] if self._transpose_state['active'] else 0

    def is_transpose_active(self) -> bool:
        """
        Check if transpose is currently active.

        Returns:
            True if transpose is active, False otherwise
        """
        return self._transpose_state['active']

    def get_transpose_config(self) -> Dict[str, Any]:
        """
        Get the transpose configuration.

        Returns:
            Dictionary with active, semitones
        """
        return {
            'active': self._transpose_state['active'],
            'semitones': self._transpose_state['semitones'],
        }

    def is_repeater_active(self) -> bool:
        """
        Check if note repeater is currently active.

        Returns:
            True if repeater is active, False otherwise
        """
        return self._repeater_state['active']

    def get_repeater_config(self) -> Dict[str, Any]:
        """
        Get the note repeater configuration.

        Returns:
            Dictionary with active, pressure_multiplier, frequency_multiplier
        """
        return {
            'active': self._repeater_state['active'],
            'pressure_multiplier': self._repeater_state['pressure_multiplier'],
            'frequency_multiplier': self._repeater_state['frequency_multiplier'],
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
