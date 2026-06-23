package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestAddTask(t *testing.T) {
	store = NewTaskStore()
	body := `{"title":"Test Task","priority":"high"}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	handleTasks(w, req)

	if w.Code != http.StatusCreated {
		t.Errorf("expected 201, got %d", w.Code)
	}

	var task Task
	json.NewDecoder(w.Body).Decode(&task)
	if task.ID != 1 {
		t.Errorf("expected ID 1, got %d", task.ID)
	}
	if task.Title != "Test Task" {
		t.Errorf("expected title 'Test Task', got '%s'", task.Title)
	}
}

func TestListTasks(t *testing.T) {
	store = NewTaskStore()
	store.Add(Task{Title: "Task 1", Priority: "low"})
	store.Add(Task{Title: "Task 2", Priority: "high"})

	req := httptest.NewRequest(http.MethodGet, "/tasks", nil)
	w := httptest.NewRecorder()
	handleTasks(w, req)

	var tasks []Task
	json.NewDecoder(w.Body).Decode(&tasks)
	if len(tasks) != 2 {
		t.Errorf("expected 2 tasks, got %d", len(tasks))
	}
}

// WILL FAIL: Get returns empty Task instead of 404
func TestGetNonExistentTask(t *testing.T) {
	store = NewTaskStore()
	req := httptest.NewRequest(http.MethodGet, "/tasks/999", nil)
	w := httptest.NewRecorder()
	handleTaskByID(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for non-existent task, got %d", w.Code)
	}
}

// WILL FAIL: Update doesn't check existence
func TestUpdateNonExistentTask(t *testing.T) {
	store = NewTaskStore()
	body := `{"title":"Ghost Task","priority":"low"}`
	req := httptest.NewRequest(http.MethodPut, "/tasks/999", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	handleTaskByID(w, req)

	if w.Code != http.StatusNotFound {
		t.Errorf("expected 404 for updating non-existent task, got %d", w.Code)
	}
}

func TestDeleteTask(t *testing.T) {
	store = NewTaskStore()
	store.Add(Task{Title: "To Delete", Priority: "low"})

	req := httptest.NewRequest(http.MethodDelete, "/tasks/1", nil)
	w := httptest.NewRecorder()
	handleTaskByID(w, req)

	if w.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", w.Code)
	}
}

// WILL FAIL: no validation on empty title
func TestAddTaskWithoutTitle(t *testing.T) {
	store = NewTaskStore()
	body := `{"priority":"high"}`
	req := httptest.NewRequest(http.MethodPost, "/tasks", bytes.NewBufferString(body))
	w := httptest.NewRecorder()
	handleTasks(w, req)

	if w.Code != http.StatusBadRequest {
		t.Errorf("expected 400 for missing title, got %d", w.Code)
	}
}
