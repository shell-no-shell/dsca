"""Dashboard for analytics visualization."""
from typing import Any, Dict, List


class DashboardApp:
    def __init__(self):
        self.data_cache: Dict[str, Any] = {}

    def render_metric(self, name: str, value: Any) -> str:
        # BUG: XSS vulnerability - no HTML escaping
        return f'<div class="metric"><h3>{name}</h3><span>{value}</span></div>'

    def render_event_list(self, events: List[Dict]) -> str:
        html = '<table><tr><th>Type</th><th>User</th><th>Time</th></tr>'
        for event in events:
            # BUG: XSS - event data inserted directly into HTML without escaping
            html += f'<tr><td>{event.get("event_type", "")}</td>'
            html += f'<td>{event.get("user_id", "")}</td>'
            html += f'<td>{event.get("timestamp", "")}</td></tr>'
        html += '</table>'
        return html

    def render_dashboard(self, metrics: Dict[str, Any], events: List[Dict]) -> str:
        parts = ['<html><body><h1>Analytics Dashboard</h1>']

        parts.append('<div class="metrics">')
        for name, value in metrics.items():
            parts.append(self.render_metric(name, value))
        parts.append('</div>')

        parts.append('<div class="events">')
        parts.append(self.render_event_list(events))
        parts.append('</div>')

        parts.append('</body></html>')
        return ''.join(parts)
