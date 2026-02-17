"""
Action Rules System

A unified system for mapping buttons to actions, supporting:
- Individual button-to-action mappings with triggers (press/release/hold)
- Button groups with group-specific actions (e.g., chord progressions)
- Startup rules (button-less actions that run on initialization)
- Button naming for user clarity

Ported from TypeScript: src/models/action-rules.ts
"""

from dataclasses import dataclass, field
from typing import Dict, Any, List, Optional, Literal, Union
import time
import random
import string


# Type aliases
ButtonId = str  # Format: "button:primary", "button:secondary", "button:1", etc.
TriggerType = Literal['press', 'release', 'hold']
ActionCategory = Literal['button', 'group', 'startup']
GroupActionType = Literal['chord-progression']

# Action definition can be a string or list with params
ActionDefinition = Union[str, List[Any], None]


@dataclass
class GroupAction:
    """
    Group action definition - action with parameters for button groups.
    Currently only chord-progression is supported.
    """
    type: GroupActionType
    progression: str  # Chord progression preset name
    octave: int = 4   # Octave for chord playback

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GroupAction':
        """Create from dictionary"""
        return cls(
            type=data.get('type', 'chord-progression'),
            progression=data.get('progression', 'c-major-pop'),
            octave=data.get('octave', 4)
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'type': self.type,
            'progression': self.progression,
            'octave': self.octave
        }


@dataclass
class ActionRule:
    """
    Individual action rule - maps a button to an action.
    """
    id: str
    button: ButtonId
    action: ActionDefinition
    name: Optional[str] = None
    trigger: TriggerType = 'release'

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ActionRule':
        """Create from dictionary (supports both snake_case and camelCase)"""
        return cls(
            id=data.get('id', generate_rule_id('rule')),
            button=data.get('button', ''),
            action=data.get('action'),
            name=data.get('name'),
            trigger=data.get('trigger', 'release')
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        result = {
            'id': self.id,
            'button': self.button,
            'action': self.action,
            'trigger': self.trigger
        }
        if self.name:
            result['name'] = self.name
        return result


@dataclass
class ButtonGroup:
    """
    Button group - a named collection of buttons.
    Actions are assigned to groups via GroupRule, not directly on the group.
    """
    id: str
    name: str
    buttons: List[ButtonId] = field(default_factory=list)

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'ButtonGroup':
        """Create from dictionary"""
        return cls(
            id=data.get('id', generate_rule_id('group')),
            name=data.get('name', ''),
            buttons=data.get('buttons', [])
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'name': self.name,
            'buttons': self.buttons
        }


@dataclass
class GroupRule:
    """
    Group rule - assigns a group action to a button group.
    """
    id: str
    group_id: str
    action: GroupAction
    name: Optional[str] = None
    trigger: TriggerType = 'release'

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'GroupRule':
        """Create from dictionary (supports both snake_case and camelCase)"""
        action_data = data.get('action', {})
        return cls(
            id=data.get('id', generate_rule_id('grouprule')),
            group_id=data.get('group_id', data.get('groupId', '')),
            action=GroupAction.from_dict(action_data) if isinstance(action_data, dict) else GroupAction(type='chord-progression', progression='c-major-pop'),
            name=data.get('name'),
            trigger=data.get('trigger', 'release')
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization (camelCase for webapp)"""
        result = {
            'id': self.id,
            'groupId': self.group_id,
            'action': self.action.to_dict(),
            'trigger': self.trigger
        }
        if self.name:
            result['name'] = self.name
        return result


@dataclass
class StartupRule:
    """
    Startup rule - an action that executes on initialization (no button).
    """
    id: str
    name: str
    action: ActionDefinition

    @classmethod
    def from_dict(cls, data: Dict[str, Any]) -> 'StartupRule':
        """Create from dictionary"""
        return cls(
            id=data.get('id', generate_rule_id('startup')),
            name=data.get('name', ''),
            action=data.get('action')
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'name': self.name,
            'action': self.action
        }


def generate_rule_id(prefix: str = 'rule') -> str:
    """Generate a unique ID for rules/groups"""
    timestamp = int(time.time() * 1000)
    random_str = ''.join(random.choices(string.ascii_lowercase + string.digits, k=9))
    return f"{prefix}-{timestamp}-{random_str}"


def parse_button_id(button_id: ButtonId) -> Dict[str, str]:
    """
    Parse a button ID into its components.
    
    Returns:
        Dict with 'type' ('stylus' or 'tablet') and 'identifier'
    """
    parts = button_id.split(':')
    if len(parts) != 2 or parts[0] != 'button':
        raise ValueError(f"Invalid button ID: {button_id}")
    
    identifier = parts[1]
    if identifier in ('primary', 'secondary'):
        return {'type': 'stylus', 'identifier': identifier}
    
    # Numeric tablet button
    try:
        num = int(identifier)
        if num < 1:
            raise ValueError(f"Invalid button ID: {button_id}")
        return {'type': 'tablet', 'identifier': identifier}
    except ValueError:
        raise ValueError(f"Invalid button ID: {button_id}")


def create_button_id(button_type: str, identifier: Union[str, int]) -> ButtonId:
    """Create a button ID from components"""
    if button_type == 'stylus':
        if identifier not in ('primary', 'secondary'):
            raise ValueError(f"Invalid stylus identifier: {identifier}")
    return f"button:{identifier}"


def get_button_label(button_id: ButtonId, button_names: Optional[Dict[ButtonId, str]] = None) -> str:
    """Get a human-readable label for a button ID"""
    # Check for custom name first
    if button_names and button_id in button_names:
        return button_names[button_id]
    
    # Generate default label
    parsed = parse_button_id(button_id)
    if parsed['type'] == 'stylus':
        return 'Primary Stylus' if parsed['identifier'] == 'primary' else 'Secondary Stylus'
    
    return f"Button {parsed['identifier']}"


class ActionRulesConfig:
    """
    Action Rules Configuration class.
    Manages button-to-action mappings, groups, and startup rules.
    """
    
    def __init__(
        self,
        button_names: Optional[Dict[ButtonId, str]] = None,
        rules: Optional[List[ActionRule]] = None,
        groups: Optional[List[ButtonGroup]] = None,
        group_rules: Optional[List[GroupRule]] = None,
        startup_rules: Optional[List[StartupRule]] = None
    ):
        self.button_names: Dict[ButtonId, str] = button_names or {}
        self.rules: List[ActionRule] = rules or []
        self.groups: List[ButtonGroup] = groups or []
        self.group_rules: List[GroupRule] = group_rules or []
        self.startup_rules: List[StartupRule] = startup_rules or []

    @classmethod
    def from_dict(cls, data: Optional[Dict[str, Any]]) -> 'ActionRulesConfig':
        """Create from a plain object (e.g., from JSON)"""
        if not data:
            return cls()
        
        # Parse button names (supports both snake_case and camelCase)
        button_names = data.get('button_names', data.get('buttonNames', {}))
        
        # Parse rules
        raw_rules = data.get('rules', [])
        rules = [ActionRule.from_dict(r) for r in raw_rules]
        
        # Parse groups
        raw_groups = data.get('groups', [])
        groups = [ButtonGroup.from_dict(g) for g in raw_groups]
        
        # Parse group rules (supports both snake_case and camelCase)
        raw_group_rules = data.get('group_rules', data.get('groupRules', []))
        group_rules = [GroupRule.from_dict(gr) for gr in raw_group_rules]
        
        # Parse startup rules (supports both snake_case and camelCase)
        raw_startup_rules = data.get('startup_rules', data.get('startupRules', []))
        startup_rules = [StartupRule.from_dict(sr) for sr in raw_startup_rules]
        
        return cls(
            button_names=button_names,
            rules=rules,
            groups=groups,
            group_rules=group_rules,
            startup_rules=startup_rules
        )

    def to_dict(self) -> Dict[str, Any]:
        """Convert to a plain object for JSON serialization (camelCase for webapp)"""
        return {
            'buttonNames': self.button_names,
            'rules': [r.to_dict() for r in self.rules],
            'groups': [g.to_dict() for g in self.groups],
            'groupRules': [gr.to_dict() for gr in self.group_rules],
            'startupRules': [sr.to_dict() for sr in self.startup_rules]
        }

    def add_rule(self, rule: ActionRule) -> ActionRule:
        """Add a new action rule"""
        if not rule.id:
            rule.id = generate_rule_id('rule')
        self.rules.append(rule)
        return rule

    def remove_rule(self, rule_id: str) -> bool:
        """Remove a rule by ID"""
        for i, rule in enumerate(self.rules):
            if rule.id == rule_id:
                self.rules.pop(i)
                return True
        return False

    def update_rule(self, rule_id: str, updates: Dict[str, Any]) -> bool:
        """Update a rule by ID"""
        for rule in self.rules:
            if rule.id == rule_id:
                for key, value in updates.items():
                    if hasattr(rule, key):
                        setattr(rule, key, value)
                return True
        return False

    def add_group(self, group: ButtonGroup) -> ButtonGroup:
        """Add a new button group"""
        if not group.id:
            group.id = generate_rule_id('group')
        self.groups.append(group)
        return group

    def remove_group(self, group_id: str) -> bool:
        """Remove a group by ID"""
        for i, group in enumerate(self.groups):
            if group.id == group_id:
                self.groups.pop(i)
                return True
        return False

    def update_group(self, group_id: str, updates: Dict[str, Any]) -> bool:
        """Update a group by ID"""
        for group in self.groups:
            if group.id == group_id:
                for key, value in updates.items():
                    if hasattr(group, key):
                        setattr(group, key, value)
                return True
        return False

    def add_group_rule(self, rule: GroupRule) -> GroupRule:
        """Add a new group rule"""
        if not rule.id:
            rule.id = generate_rule_id('grouprule')
        self.group_rules.append(rule)
        return rule

    def remove_group_rule(self, rule_id: str) -> bool:
        """Remove a group rule by ID"""
        for i, rule in enumerate(self.group_rules):
            if rule.id == rule_id:
                self.group_rules.pop(i)
                return True
        return False

    def update_group_rule(self, rule_id: str, updates: Dict[str, Any]) -> bool:
        """Update a group rule by ID"""
        for rule in self.group_rules:
            if rule.id == rule_id:
                for key, value in updates.items():
                    if hasattr(rule, key):
                        setattr(rule, key, value)
                return True
        return False

    def get_group_rule_for_group(self, group_id: str) -> Optional[GroupRule]:
        """Get the group rule for a specific group (if any)"""
        for rule in self.group_rules:
            if rule.group_id == group_id:
                return rule
        return None

    def add_startup_rule(self, rule: StartupRule) -> StartupRule:
        """Add a startup rule"""
        if not rule.id:
            rule.id = generate_rule_id('startup')
        self.startup_rules.append(rule)
        return rule

    def remove_startup_rule(self, rule_id: str) -> bool:
        """Remove a startup rule by ID"""
        for i, rule in enumerate(self.startup_rules):
            if rule.id == rule_id:
                self.startup_rules.pop(i)
                return True
        return False

    def set_button_name(self, button_id: ButtonId, name: str) -> None:
        """Set a button's name"""
        if name:
            self.button_names[button_id] = name
        elif button_id in self.button_names:
            del self.button_names[button_id]

    def get_rules_for_button(self, button_id: ButtonId) -> List[ActionRule]:
        """Get all rules for a specific button"""
        return [r for r in self.rules if r.button == button_id]

    def get_group_for_button(self, button_id: ButtonId) -> Optional[ButtonGroup]:
        """Get the group that contains a specific button (if any)"""
        for group in self.groups:
            if button_id in group.buttons:
                return group
        return None

    def get_action_for_button_event(self, button_id: ButtonId, trigger: TriggerType) -> Optional[ActionDefinition]:
        """
        Get the action for a button press/release/hold event.
        Returns the action definition if found, or None if no matching rule.
        """
        # First check individual rules
        for rule in self.rules:
            rule_trigger = rule.trigger or 'release'
            if rule.button == button_id and rule_trigger == trigger:
                return rule.action
        
        # Then check groups - respect the trigger setting on the group rule (defaults to 'release')
        group = self.get_group_for_button(button_id)
        if group:
            try:
                button_index = group.buttons.index(button_id)
            except ValueError:
                button_index = -1
            
            if button_index >= 0:
                # Find the group rule for this group
                group_rule = self.get_group_rule_for_group(group.id)
                if group_rule:
                    # Check if the trigger matches (default to 'release' if not specified)
                    rule_trigger = group_rule.trigger or 'release'
                    if rule_trigger == trigger:
                        # Handle group action based on type
                        if group_rule.action.type == 'chord-progression':
                            # Return a set-chord-in-progression action
                            return ['set-chord-in-progression', group_rule.action.progression, button_index, group_rule.action.octave]
        
        return None


# Default empty configuration
DEFAULT_ACTION_RULES_CONFIG = ActionRulesConfig()
