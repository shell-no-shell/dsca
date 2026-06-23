"""Task Manager API - FastAPI Backend"""
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from typing import Optional, List
import sqlite3
import os
from datetime import datetime

app = FastAPI(title="Task Manager API")

# BUG 1: CORS is configured but with wrong allow_methods (missing PUT and DELETE)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["GET", "POST"],  # BUG: Missing PUT, DELETE
    allow_headers=["*"],
)

DATABASE = os.path.join(os.path.dirname(__file__), "tasks.db")


class TaskCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = None
    priority: str = Field(default="medium")
    due_date: Optional[str] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    due_date: Optional[str] = None


class TaskResponse(BaseModel):
    id: int
    title: str
    description: Optional[str]
    priority: str
    status: str
    due_date: Optional[str]
    created_at: str
    updated_at: str


def get_db():
    conn = sqlite3.connect(DATABASE)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    conn = get_db()
    conn.execute("""
        CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            priority TEXT DEFAULT 'medium',
            status TEXT DEFAULT 'pending',
            due_date TEXT,
            created_at TEXT DEFAULT (datetime('now')),
            updated_at TEXT DEFAULT (datetime('now'))
        )
    """)
    conn.commit()
    conn.close()


init_db()


@app.get("/api/tasks", response_model=List[TaskResponse])
def list_tasks(
    page: int = Query(1, ge=1),
    per_page: int = Query(10, ge=1, le=100),
    status: Optional[str] = None,
    priority: Optional[str] = None,
):
    conn = get_db()
    try:
        # BUG 2: SQL Injection vulnerability - using f-string for status filter
        query = "SELECT * FROM tasks"
        conditions = []
        params = []

        if status:
            conditions.append(f"status = '{status}'")  # BUG: SQL injection
        if priority:
            conditions.append("priority = ?")
            params.append(priority)

        if conditions:
            query += " WHERE " + " AND ".join(conditions)

        query += " ORDER BY created_at DESC"

        # BUG 3: Pagination is wrong - OFFSET should be (page-1)*per_page
        query += f" LIMIT {per_page} OFFSET {page * per_page}"  # BUG: Wrong offset

        cursor = conn.execute(query, params)
        rows = cursor.fetchall()
        return [dict(row) for row in rows]
    finally:
        conn.close()


@app.post("/api/tasks", response_model=TaskResponse)
def create_task(task: TaskCreate):
    conn = get_db()
    try:
        # BUG 4: No validation that priority is a valid value
        cursor = conn.execute(
            "INSERT INTO tasks (title, description, priority, due_date) VALUES (?, ?, ?, ?)",
            (task.title, task.description, task.priority, task.due_date),
        )
        conn.commit()
        task_id = cursor.lastrowid

        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.get("/api/tasks/{task_id}", response_model=TaskResponse)
def get_task(task_id: int):
    conn = get_db()
    try:
        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Task not found")
        return dict(row)
    finally:
        conn.close()


@app.put("/api/tasks/{task_id}", response_model=TaskResponse)
def update_task(task_id: int, task: TaskUpdate):
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not existing:
            # BUG 5: Returns 400 instead of 404 for not found
            raise HTTPException(status_code=400, detail="Task not found")

        updates = {}
        if task.title is not None:
            updates["title"] = task.title
        if task.description is not None:
            updates["description"] = task.description
        if task.priority is not None:
            updates["priority"] = task.priority
        if task.status is not None:
            updates["status"] = task.status
        if task.due_date is not None:
            updates["due_date"] = task.due_date

        if updates:
            updates["updated_at"] = datetime.now().isoformat()
            set_clause = ", ".join(f"{k} = ?" for k in updates.keys())
            values = list(updates.values()) + [task_id]
            conn.execute(
                f"UPDATE tasks SET {set_clause} WHERE id = ?", values
            )
            conn.commit()

        row = conn.execute("SELECT * FROM tasks WHERE id = ?", (task_id,)).fetchone()
        return dict(row)
    finally:
        conn.close()


@app.delete("/api/tasks/{task_id}")
def delete_task(task_id: int):
    conn = get_db()
    try:
        existing = conn.execute(
            "SELECT * FROM tasks WHERE id = ?", (task_id,)
        ).fetchone()
        if not existing:
            raise HTTPException(status_code=404, detail="Task not found")

        conn.execute("DELETE FROM tasks WHERE id = ?", (task_id,))
        conn.commit()
        return {"message": "Task deleted"}
    finally:
        conn.close()


@app.get("/api/tasks/stats/summary")
def get_stats():
    conn = get_db()
    try:
        total = conn.execute("SELECT COUNT(*) FROM tasks").fetchone()[0]
        by_status = conn.execute(
            "SELECT status, COUNT(*) as count FROM tasks GROUP BY status"
        ).fetchall()
        by_priority = conn.execute(
            "SELECT priority, COUNT(*) as count FROM tasks GROUP BY priority"
        ).fetchall()

        return {
            "total": total,
            "by_status": {row[0]: row[1] for row in by_status},
            "by_priority": {row[0]: row[1] for row in by_priority},
        }
    finally:
        conn.close()
