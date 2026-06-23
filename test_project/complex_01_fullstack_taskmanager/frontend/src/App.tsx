import React, { useState, useEffect } from "react";
import { Task, fetchTasks, createTask, deleteTask, updateTask } from "./api";
import { TaskCard } from "./components/TaskCard";

function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [priority, setPriority] = useState("medium");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadTasks();
  }, []);

  async function loadTasks() {
    setLoading(true);
    try {
      const data = await fetchTasks();
      setTasks(data);
    } catch (err) {
      setError("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;

    try {
      await createTask({ title, description, priority });
      setTitle("");
      setDescription("");
      loadTasks();
    } catch (err) {
      setError("Failed to create task");
    }
  }

  async function handleDelete(id: number) {
    try {
      await deleteTask(id);
      loadTasks();
    } catch (err) {
      setError("Failed to delete task");
    }
  }

  async function handleToggleStatus(task: Task) {
    const newStatus = task.status === "completed" ? "pending" : "completed";
    try {
      await updateTask(task.id, { status: newStatus });
      loadTasks();
    } catch (err) {
      setError("Failed to update task");
    }
  }

  return (
    <div style={{ maxWidth: 800, margin: "0 auto", padding: 20 }}>
      <h1>Task Manager</h1>

      {error && (
        <div style={{ color: "red", marginBottom: 10 }}>
          {error}
          <button onClick={() => setError(null)}>Dismiss</button>
        </div>
      )}

      <form onSubmit={handleCreate} style={{ marginBottom: 20 }}>
        <input
          type="text"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Task title"
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description (optional)"
          style={{ width: "100%", padding: 8, marginBottom: 8 }}
        />
        <select
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          style={{ padding: 8, marginRight: 8 }}
        >
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
        </select>
        <button type="submit" style={{ padding: 8 }}>
          Add Task
        </button>
      </form>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <div>
          {tasks.map((task) => (
            // BUG: Missing key prop warning - using index instead of task.id
            <TaskCard
              task={task}
              onDelete={() => handleDelete(task.id)}
              onToggle={() => handleToggleStatus(task)}
            />
          ))}
          {tasks.length === 0 && <p>No tasks yet. Create one above!</p>}
        </div>
      )}
    </div>
  );
}

export default App;
