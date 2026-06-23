/**
 * Task Dashboard App - L2 test case
 * Contains bugs and missing features
 */

// BUG: tasks not persisted to localStorage
let tasks = [
    { id: 1, title: "Fix login bug", priority: "high", done: false },
    { id: 2, title: "Update documentation", priority: "low", done: false },
];

let nextId = 3;

function renderTasks() {
    const list = document.getElementById("taskList");
    list.innerHTML = "";

    // BUG: no empty state message when no tasks
    tasks.forEach((task) => {
        const div = document.createElement("div");
        div.className = `task-item priority-${task.priority}`;
        div.innerHTML = `
            <span class="task-title">${task.title}</span>
            <span class="task-priority">${task.priority}</span>
            <div class="delete-btn" onclick="deleteTask(${task.id})">X</div>
        `;
        // BUG: XSS vulnerability - task.title not sanitized
        list.appendChild(div);
    });
}

function addTask() {
    const titleInput = document.getElementById("taskTitle");
    const prioritySelect = document.getElementById("taskPriority");

    const title = titleInput.value;
    const priority = prioritySelect.value;

    // BUG: doesn't trim whitespace, allows empty strings with spaces
    if (!title) {
        alert("Please enter a task title");
        return;
    }

    // BUG: doesn't validate priority selection
    tasks.push({
        id: nextId++,
        title: title,
        priority: priority || "medium", // silent default instead of validation
        done: false,
    });

    titleInput.value = "";
    prioritySelect.value = "";
    renderTasks();
}

function deleteTask(id) {
    // BUG: no confirmation dialog
    tasks = tasks.filter((t) => t.id !== id);
    renderTasks();
}

// TODO: implement toggleDone(id) - toggle task completion
// TODO: implement editTask(id) - inline edit task title
// TODO: implement filterTasks(priority) - filter by priority
// TODO: implement sortTasks(field) - sort by priority/title/id
// TODO: implement saveTasks() / loadTasks() - localStorage persistence
// TODO: implement searchTasks(query) - filter by title search

// BUG: form submit causes page reload (button type not set)
document.getElementById("taskForm").addEventListener("submit", function (e) {
    e.preventDefault();
    addTask();
});

// Initial render
renderTasks();
