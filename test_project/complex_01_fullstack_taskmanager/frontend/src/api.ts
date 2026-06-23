import axios from "axios";

// BUG: Wrong base URL - should be /api but points to wrong port without proxy
const api = axios.create({
  baseURL: "http://localhost:8000",  // BUG: Should use relative URL /api with vite proxy
  timeout: 5000,
});

export interface Task {
  id: number;
  title: string;
  description?: string;
  priority: string;
  status: string;
  due_date?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateTaskInput {
  title: string;
  description?: string;
  priority?: string;
  due_date?: string;
}

export async function fetchTasks(page = 1, perPage = 10): Promise<Task[]> {
  const response = await api.get(`/api/tasks?page=${page}&per_page=${perPage}`);
  return response.data;
}

export async function createTask(task: CreateTaskInput): Promise<Task> {
  const response = await api.post("/api/tasks", task);
  return response.data;
}

export async function updateTask(
  id: number,
  updates: Partial<Task>
): Promise<Task> {
  const response = await api.put(`/api/tasks/${id}`, updates);
  return response.data;
}

export async function deleteTask(id: number): Promise<void> {
  await api.delete(`/api/tasks/${id}`);
}

// BUG: No error handling wrapper - errors crash the UI silently
