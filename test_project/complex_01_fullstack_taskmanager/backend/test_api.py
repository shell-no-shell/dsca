"""Tests for Task Manager API"""
import pytest
import os
import sys
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.dirname(__file__))

# Use a test database
os.environ["TESTING"] = "1"
import app as app_module

app_module.DATABASE = os.path.join(os.path.dirname(__file__), "test_tasks.db")
app_module.init_db()

from app import app

client = TestClient(app)


@pytest.fixture(autouse=True)
def clean_db():
    """Clean database before each test"""
    conn = app_module.get_db()
    conn.execute("DELETE FROM tasks")
    conn.commit()
    conn.close()
    yield


class TestCreateTask:
    def test_create_valid_task(self):
        response = client.post(
            "/api/tasks",
            json={"title": "Test Task", "description": "A test task", "priority": "high"},
        )
        assert response.status_code == 200
        data = response.json()
        assert data["title"] == "Test Task"
        assert data["priority"] == "high"
        assert data["status"] == "pending"

    def test_create_task_empty_title(self):
        response = client.post("/api/tasks", json={"title": ""})
        assert response.status_code == 422

    def test_create_task_invalid_priority(self):
        """Priority should only be low, medium, or high"""
        response = client.post(
            "/api/tasks", json={"title": "Test", "priority": "invalid_priority"}
        )
        # BUG: This test will FAIL because there's no priority validation
        assert response.status_code == 422


class TestListTasks:
    def test_list_empty(self):
        response = client.get("/api/tasks")
        assert response.status_code == 200
        assert response.json() == []

    def test_pagination_first_page(self):
        """Create 15 tasks, first page should have 10"""
        for i in range(15):
            client.post("/api/tasks", json={"title": f"Task {i}"})

        response = client.get("/api/tasks?page=1&per_page=10")
        assert response.status_code == 200
        data = response.json()
        # BUG: This test will FAIL because pagination offset is wrong
        # page=1 should return the first 10, but offset is page*per_page=10
        assert len(data) == 10

    def test_pagination_second_page(self):
        """Second page should have remaining 5"""
        for i in range(15):
            client.post("/api/tasks", json={"title": f"Task {i}"})

        response = client.get("/api/tasks?page=2&per_page=10")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 5

    def test_filter_by_status(self):
        client.post("/api/tasks", json={"title": "Pending task"})
        task = client.post("/api/tasks", json={"title": "Done task"}).json()
        client.put(f"/api/tasks/{task['id']}", json={"status": "completed"})

        response = client.get("/api/tasks?status=completed")
        assert response.status_code == 200
        data = response.json()
        assert len(data) == 1
        assert data[0]["title"] == "Done task"

    def test_sql_injection_prevention(self):
        """Status filter should not be vulnerable to SQL injection"""
        client.post("/api/tasks", json={"title": "Secret task"})

        # This should NOT return any results or cause an error
        response = client.get("/api/tasks?status=' OR '1'='1")
        assert response.status_code == 200
        # BUG: This test will FAIL because of SQL injection vulnerability
        # The injected SQL will match all rows
        assert len(response.json()) == 0


class TestUpdateTask:
    def test_update_existing_task(self):
        task = client.post("/api/tasks", json={"title": "Original"}).json()
        response = client.put(
            f"/api/tasks/{task['id']}", json={"title": "Updated"}
        )
        assert response.status_code == 200
        assert response.json()["title"] == "Updated"

    def test_update_nonexistent_task(self):
        response = client.put("/api/tasks/99999", json={"title": "Nope"})
        # BUG: This test will FAIL because app returns 400 instead of 404
        assert response.status_code == 404


class TestDeleteTask:
    def test_delete_existing_task(self):
        task = client.post("/api/tasks", json={"title": "To delete"}).json()
        response = client.delete(f"/api/tasks/{task['id']}")
        assert response.status_code == 200

        get_response = client.get(f"/api/tasks/{task['id']}")
        assert get_response.status_code == 404

    def test_delete_nonexistent_task(self):
        response = client.delete("/api/tasks/99999")
        assert response.status_code == 404


class TestStats:
    def test_stats_summary(self):
        client.post("/api/tasks", json={"title": "T1", "priority": "high"})
        client.post("/api/tasks", json={"title": "T2", "priority": "low"})
        task = client.post("/api/tasks", json={"title": "T3", "priority": "high"}).json()
        client.put(f"/api/tasks/{task['id']}", json={"status": "completed"})

        response = client.get("/api/tasks/stats/summary")
        assert response.status_code == 200
        data = response.json()
        assert data["total"] == 3
        assert data["by_priority"]["high"] == 2
