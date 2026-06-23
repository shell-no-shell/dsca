import React from "react";
import { Task } from "../api";

interface TaskCardProps {
  task: Task;
  onDelete: () => void;
  onToggle: () => void;
}

export function TaskCard({ task, onDelete, onToggle }: TaskCardProps) {
  const priorityColors: Record<string, string> = {
    high: "#ff4444",
    medium: "#ffaa00",
    low: "#44aa44",
  };

  return (
    <div
      style={{
        border: "1px solid #ddd",
        borderLeft: `4px solid ${priorityColors[task.priority] || "#999"}`,
        padding: 12,
        marginBottom: 8,
        borderRadius: 4,
        opacity: task.status === "completed" ? 0.6 : 1,
        textDecoration: task.status === "completed" ? "line-through" : "none",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between" }}>
        <div>
          <strong>{task.title}</strong>
          {task.description && <p style={{ margin: "4px 0", color: "#666" }}>{task.description}</p>}
          <small style={{ color: "#999" }}>
            {task.priority} | {task.status} | Created: {task.created_at}
          </small>
        </div>
        <div>
          <button onClick={onToggle} style={{ marginRight: 4 }}>
            {task.status === "completed" ? "Reopen" : "Complete"}
          </button>
          <button onClick={onDelete} style={{ color: "red" }}>
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}
