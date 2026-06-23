"""ClickHouse client for storing analytics events."""
from typing import Any, Dict, List, Optional
from datetime import datetime


class ClickHouseClient:
    """Mock ClickHouse client for testing."""

    def __init__(self, host: str = "localhost", port: int = 9000):
        self.host = host
        self.port = port
        self.tables: Dict[str, List[Dict]] = {}
        self.connected = False

    def connect(self):
        self.connected = True

    def disconnect(self):
        self.connected = False

    def _ensure_connected(self):
        if not self.connected:
            raise ConnectionError("Not connected to ClickHouse")

    def create_table(self, table_name: str, columns: Dict[str, str]):
        self._ensure_connected()
        self.tables[table_name] = []

    def insert(self, table_name: str, data: Dict[str, Any]):
        self._ensure_connected()
        if table_name not in self.tables:
            raise ValueError(f"Table {table_name} does not exist")
        self.tables[table_name].append(data)

    def insert_batch(self, table_name: str, records: List[Dict[str, Any]]):
        self._ensure_connected()
        if table_name not in self.tables:
            raise ValueError(f"Table {table_name} does not exist")
        self.tables[table_name].extend(records)

    def query(self, sql: str, params: Optional[Dict] = None) -> List[Dict]:
        self._ensure_connected()

        # BUG: SQL injection - string formatting instead of parameterized queries
        if params:
            for key, value in params.items():
                sql = sql.replace(f"{{{key}}}", str(value))  # BUG: No escaping

        # Simple mock query engine
        return self._execute_mock_query(sql)

    def _execute_mock_query(self, sql: str) -> List[Dict]:
        sql_lower = sql.lower().strip()

        if sql_lower.startswith("select"):
            # Extract table name (very simplified)
            parts = sql_lower.split("from")
            if len(parts) < 2:
                return []
            table_part = parts[1].strip().split()[0]
            table_name = table_part.strip()

            if table_name not in self.tables:
                return []

            records = self.tables[table_name]

            # Handle WHERE clause (simplified)
            if "where" in sql_lower:
                where_part = sql_lower.split("where")[1].strip()
                records = self._filter_records(records, where_part)

            return records

        return []

    def _filter_records(self, records: List[Dict], where_clause: str) -> List[Dict]:
        # Very simplified WHERE filtering for testing
        result = []
        for record in records:
            # Just return all for now - the real implementation would parse the clause
            result.append(record)
        return result

    def count(self, table_name: str) -> int:
        self._ensure_connected()
        if table_name not in self.tables:
            return 0
        return len(self.tables[table_name])
