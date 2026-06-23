"""Window-based event aggregation for analytics."""
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional
from collections import defaultdict


class TimeWindow:
    def __init__(self, start: datetime, end: datetime):
        self.start = start
        self.end = end

    def contains(self, timestamp: datetime) -> bool:
        return self.start <= timestamp < self.end

    def __repr__(self):
        return f"TimeWindow({self.start} -> {self.end})"

    def __eq__(self, other):
        return self.start == other.start and self.end == other.end

    def __hash__(self):
        return hash((self.start, self.end))


class EventAggregator:
    def __init__(self, window_size_minutes: int = 5):
        self.window_size = timedelta(minutes=window_size_minutes)
        self.windows: Dict[TimeWindow, List[Dict]] = defaultdict(list)

    def get_window(self, timestamp: datetime) -> TimeWindow:
        # BUG 1: Timezone handling - doesn't normalize to UTC
        # Events with different timezone offsets get placed in wrong windows
        minutes = timestamp.minute
        window_start_minute = (minutes // (self.window_size.seconds // 60)) * (self.window_size.seconds // 60)

        window_start = timestamp.replace(
            minute=window_start_minute, second=0, microsecond=0
        )
        window_end = window_start + self.window_size
        return TimeWindow(window_start, window_end)

    def add_event(self, event: Dict[str, Any]) -> TimeWindow:
        timestamp = event.get("_parsed_timestamp")
        if timestamp is None:
            timestamp_str = event.get("timestamp", "")
            try:
                timestamp = datetime.fromisoformat(timestamp_str)
            except (ValueError, TypeError):
                raise ValueError(f"Invalid timestamp: {timestamp_str}")

        window = self.get_window(timestamp)
        self.windows[window].append(event)
        return window

    def aggregate(self, window: Optional[TimeWindow] = None) -> Dict[str, Any]:
        if window:
            events = self.windows.get(window, [])
            return self._compute_aggregates(events, window)

        results = {}
        for w, events in self.windows.items():
            results[str(w)] = self._compute_aggregates(events, w)
        return results

    def _compute_aggregates(self, events: List[Dict], window: TimeWindow) -> Dict[str, Any]:
        if not events:
            return {
                "window": str(window),
                "count": 0,
                "by_type": {},
                "unique_users": 0,
            }

        by_type = defaultdict(int)
        users = set()

        for event in events:
            event_type = event.get("event_type", "unknown")
            by_type[event_type] += 1

            user_id = event.get("user_id")
            if user_id:
                users.add(user_id)

        return {
            "window": str(window),
            "count": len(events),
            "by_type": dict(by_type),
            "unique_users": len(users),
        }

    def get_windows(self) -> List[TimeWindow]:
        return sorted(self.windows.keys(), key=lambda w: w.start)


class EventEnricher:
    def __init__(self, geo_data: Optional[Dict] = None):
        self.geo_data = geo_data or {}
        self.user_cache: Dict[str, Dict] = {}

    def enrich(self, event: Dict[str, Any]) -> Dict[str, Any]:
        enriched = dict(event)

        # BUG 2: No null/None handling - crashes if properties is None
        properties = enriched["properties"]  # Could be None
        ip = properties.get("ip_address", "")  # AttributeError if None

        if ip and ip in self.geo_data:
            enriched["geo"] = self.geo_data[ip]

        # Add user session data
        user_id = enriched.get("user_id", "")
        if user_id in self.user_cache:
            enriched["user_data"] = self.user_cache[user_id]

        # BUG 3: Mutates the original event dict through shared references
        enriched["enriched_at"] = datetime.now(timezone.utc).isoformat()

        return enriched

    def set_user_cache(self, user_id: str, data: Dict):
        self.user_cache[user_id] = data
