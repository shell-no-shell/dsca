"""Event schema validation for the analytics pipeline."""
from datetime import datetime
from typing import Any, Dict, List, Optional
import json
import re


VALID_EVENT_TYPES = [
    "page_view", "click", "purchase", "signup",
    "login", "logout", "error", "custom",
]


class SchemaError(Exception):
    pass


class EventSchema:
    REQUIRED_FIELDS = ["event_type", "timestamp", "user_id"]

    FIELD_TYPES = {
        "event_type": str,
        "timestamp": str,
        "user_id": str,
        "session_id": str,
        "properties": dict,
        "metadata": dict,
    }

    def validate(self, event: Dict[str, Any]) -> Dict[str, Any]:
        if not isinstance(event, dict):
            raise SchemaError("Event must be a dictionary")

        # Check required fields
        for field in self.REQUIRED_FIELDS:
            if field not in event:
                raise SchemaError(f"Missing required field: {field}")

        # BUG 1: Doesn't validate event_type against VALID_EVENT_TYPES
        # Any string passes through
        event_type = event["event_type"]
        if not isinstance(event_type, str):
            raise SchemaError("event_type must be a string")

        # Validate timestamp format
        timestamp = event["timestamp"]
        try:
            parsed = datetime.fromisoformat(timestamp)
            event["_parsed_timestamp"] = parsed
        except (ValueError, TypeError):
            raise SchemaError(f"Invalid timestamp format: {timestamp}")

        # Validate user_id
        user_id = event["user_id"]
        if not isinstance(user_id, str) or len(user_id) == 0:
            raise SchemaError("user_id must be a non-empty string")

        # BUG 2: Doesn't validate field types for optional fields
        # properties could be a string or list and wouldn't be caught
        if "properties" in event:
            props = event["properties"]
            # Should check isinstance(props, dict) but doesn't

        # Validate and normalize
        validated = {
            "event_type": event_type,
            "timestamp": timestamp,
            "user_id": user_id,
            "session_id": event.get("session_id", ""),
            "properties": event.get("properties", {}),
            "metadata": event.get("metadata", {}),
        }

        return validated

    def validate_batch(self, events: List[Dict[str, Any]]) -> tuple:
        valid = []
        errors = []
        for i, event in enumerate(events):
            try:
                validated = self.validate(event)
                valid.append(validated)
            except SchemaError as e:
                errors.append({"index": i, "error": str(e), "event": event})
        return valid, errors
