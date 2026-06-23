"""Tests for the analytics pipeline."""
import pytest
import sys
import os
from datetime import datetime, timezone, timedelta
from copy import deepcopy

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from ingestion.schema import EventSchema, SchemaError
from processing.aggregator import EventAggregator, EventEnricher
from storage.clickhouse_client import ClickHouseClient
from dashboard.app import DashboardApp


# ===== Schema Tests =====

class TestEventSchema:
    def setup_method(self):
        self.schema = EventSchema()

    def test_valid_event(self):
        event = {
            "event_type": "page_view",
            "timestamp": "2024-01-15T10:30:00+00:00",
            "user_id": "user_123",
            "properties": {"page": "/home"},
        }
        result = self.schema.validate(event)
        assert result["event_type"] == "page_view"
        assert result["user_id"] == "user_123"

    def test_missing_required_field(self):
        event = {"event_type": "click", "timestamp": "2024-01-15T10:00:00+00:00"}
        with pytest.raises(SchemaError, match="Missing required field"):
            self.schema.validate(event)

    def test_invalid_timestamp(self):
        event = {
            "event_type": "click",
            "timestamp": "not-a-date",
            "user_id": "user_1",
        }
        with pytest.raises(SchemaError, match="Invalid timestamp"):
            self.schema.validate(event)

    def test_invalid_event_type_rejected(self):
        """Invalid event types should be rejected"""
        event = {
            "event_type": "definitely_not_valid_type",
            "timestamp": "2024-01-15T10:00:00+00:00",
            "user_id": "user_1",
        }
        # BUG TEST: This should raise SchemaError but doesn't
        with pytest.raises(SchemaError):
            self.schema.validate(event)

    def test_properties_must_be_dict(self):
        """Properties field, if present, must be a dict"""
        event = {
            "event_type": "click",
            "timestamp": "2024-01-15T10:00:00+00:00",
            "user_id": "user_1",
            "properties": "not a dict",
        }
        # BUG TEST: Should reject non-dict properties
        with pytest.raises(SchemaError):
            self.schema.validate(event)

    def test_batch_validation(self):
        events = [
            {"event_type": "click", "timestamp": "2024-01-15T10:00:00+00:00", "user_id": "u1"},
            {"event_type": "click"},  # missing fields
            {"event_type": "page_view", "timestamp": "2024-01-15T10:01:00+00:00", "user_id": "u2"},
        ]
        valid, errors = self.schema.validate_batch(events)
        assert len(valid) == 2
        assert len(errors) == 1
        assert errors[0]["index"] == 1


# ===== Aggregator Tests =====

class TestEventAggregator:
    def setup_method(self):
        self.agg = EventAggregator(window_size_minutes=5)

    def test_basic_aggregation(self):
        events = [
            {"event_type": "click", "timestamp": "2024-01-15T10:01:00", "user_id": "u1"},
            {"event_type": "click", "timestamp": "2024-01-15T10:02:00", "user_id": "u2"},
            {"event_type": "page_view", "timestamp": "2024-01-15T10:03:00", "user_id": "u1"},
        ]
        for event in events:
            self.agg.add_event(event)

        windows = self.agg.get_windows()
        assert len(windows) == 1

        result = self.agg.aggregate(windows[0])
        assert result["count"] == 3
        assert result["unique_users"] == 2
        assert result["by_type"]["click"] == 2

    def test_multiple_windows(self):
        events = [
            {"event_type": "click", "timestamp": "2024-01-15T10:01:00", "user_id": "u1"},
            {"event_type": "click", "timestamp": "2024-01-15T10:06:00", "user_id": "u2"},
        ]
        for event in events:
            self.agg.add_event(event)

        windows = self.agg.get_windows()
        assert len(windows) == 2

    def test_timezone_aware_events(self):
        """Events with timezone info should be placed in correct windows"""
        # These are the SAME moment in time, just different timezone representations
        events = [
            {"event_type": "click", "timestamp": "2024-01-15T10:01:00+00:00", "user_id": "u1"},
            {"event_type": "click", "timestamp": "2024-01-15T18:01:00+08:00", "user_id": "u2"},
        ]
        for event in events:
            self.agg.add_event(event)

        # BUG TEST: Both events represent the same UTC time, should be in same window
        windows = self.agg.get_windows()
        assert len(windows) == 1, f"Same UTC time should be in 1 window, got {len(windows)}"


# ===== Enricher Tests =====

class TestEventEnricher:
    def setup_method(self):
        self.enricher = EventEnricher(
            geo_data={"1.2.3.4": {"country": "US", "city": "NYC"}}
        )

    def test_basic_enrichment(self):
        event = {
            "event_type": "click",
            "user_id": "u1",
            "properties": {"ip_address": "1.2.3.4"},
        }
        result = self.enricher.enrich(event)
        assert result["geo"]["country"] == "US"
        assert "enriched_at" in result

    def test_no_ip(self):
        event = {
            "event_type": "click",
            "user_id": "u1",
            "properties": {},
        }
        result = self.enricher.enrich(event)
        assert "geo" not in result

    def test_null_properties(self):
        """Should handle event with None properties gracefully"""
        event = {
            "event_type": "click",
            "user_id": "u1",
            "properties": None,
        }
        # BUG TEST: This crashes with AttributeError because properties is None
        result = self.enricher.enrich(event)
        assert "geo" not in result

    def test_missing_properties(self):
        """Should handle event with no properties key"""
        event = {
            "event_type": "click",
            "user_id": "u1",
        }
        # BUG TEST: This crashes with KeyError
        result = self.enricher.enrich(event)
        assert "geo" not in result

    def test_enrichment_doesnt_mutate_original(self):
        """Enrichment should not modify the original event"""
        original = {
            "event_type": "click",
            "user_id": "u1",
            "properties": {"ip_address": "1.2.3.4"},
        }
        original_copy = deepcopy(original)
        self.enricher.enrich(original)
        # BUG TEST: Original event gets mutated via shared dict reference
        assert original == original_copy, "Original event was mutated by enrich()"


# ===== Dashboard Security Tests =====

class TestDashboardSecurity:
    def setup_method(self):
        self.dashboard = DashboardApp()

    def test_xss_in_metric_name(self):
        """Metric names with HTML should be escaped"""
        html = self.dashboard.render_metric(
            '<script>alert("xss")</script>', 42
        )
        # BUG TEST: Script tag should be escaped in output
        assert "<script>" not in html, "XSS: script tag not escaped in metric name"

    def test_xss_in_event_data(self):
        """Event data with HTML should be escaped"""
        events = [{
            "event_type": '<img src=x onerror=alert(1)>',
            "user_id": "user_1",
            "timestamp": "2024-01-15T10:00:00",
        }]
        html = self.dashboard.render_event_list(events)
        # BUG TEST: Event type with HTML should be escaped
        assert "<img" not in html, "XSS: img tag not escaped in event list"

    def test_xss_in_user_id(self):
        """User ID with HTML should be escaped"""
        events = [{
            "event_type": "click",
            "user_id": '"><script>alert(document.cookie)</script>',
            "timestamp": "2024-01-15T10:00:00",
        }]
        html = self.dashboard.render_event_list(events)
        assert "<script>" not in html, "XSS: script tag not escaped in user_id"


# ===== ClickHouse Client Tests =====

class TestClickHouseClient:
    def setup_method(self):
        self.client = ClickHouseClient()
        self.client.connect()
        self.client.create_table("events", {
            "event_type": "String",
            "timestamp": "DateTime",
            "user_id": "String",
        })

    def test_insert_and_count(self):
        self.client.insert("events", {"event_type": "click", "user_id": "u1"})
        self.client.insert("events", {"event_type": "page_view", "user_id": "u2"})
        assert self.client.count("events") == 2

    def test_insert_to_nonexistent_table(self):
        with pytest.raises(ValueError):
            self.client.insert("nonexistent", {"key": "value"})

    def test_query_not_connected(self):
        client = ClickHouseClient()
        with pytest.raises(ConnectionError):
            client.query("SELECT * FROM events")

    def test_sql_injection_prevention(self):
        """Query params should be properly escaped"""
        self.client.insert("events", {
            "event_type": "click",
            "user_id": "normal_user",
        })

        # This malicious param should not cause issues
        result = self.client.query(
            "SELECT * FROM events WHERE user_id = {user_id}",
            params={"user_id": "'; DROP TABLE events; --"}
        )
        # The table should still exist after the "injection"
        assert self.client.count("events") == 1
