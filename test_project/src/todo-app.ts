/**
 * A simple Todo application for testing DS-CodeAgent's
 * ability to understand and modify more complex code.
 */

export interface Todo {
  id: number;
  title: string;
  completed: boolean;
  createdAt: Date;
}

export class TodoApp {
  private todos: Todo[] = [];
  private nextId: number = 1;

  add(title: string): Todo {
    const todo: Todo = {
      id: this.nextId++,
      title,
      completed: false,
      createdAt: new Date()
    };
    this.todos.push(todo);
    return todo;
  }

  toggle(id: number): boolean {
    const todo = this.todos.find(t => t.id === id);
    if (!todo) return false;
    todo.completed = !todo.completed;
    return true;
  }

  remove(id: number): boolean {
    const index = this.todos.findIndex(t => t.id === id);
    if (index === -1) return false;
    this.todos.splice(index, 1);
    return true;
  }

  getAll(): Todo[] {
    return [...this.todos];
  }

  getCompleted(): Todo[] {
    return this.todos.filter(t => t.completed);
  }

  getPending(): Todo[] {
    return this.todos.filter(t => !t.completed);
  }

  // TODO: Add these features:
  // - edit(id, newTitle): update todo title
  // - clearCompleted(): remove all completed todos
  // - search(query): find todos matching query
  // - sortByDate(): return todos sorted by creation date
  // - toJSON(): export as JSON string
  // - fromJSON(json): import from JSON string
}
