"""
Flask-style web API - L2/L3 test case.
A simple TODO API with intentional issues.
"""
from http.server import HTTPServer, BaseHTTPRequestHandler
import json

# In-memory storage
todos = []
next_id = 1


class TodoHandler(BaseHTTPRequestHandler):
    def _send_json(self, status, data):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

    def _read_body(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        return json.loads(body) if body else {}

    def do_GET(self):
        if self.path == "/todos":
            self._send_json(200, {"todos": todos})
        elif self.path.startswith("/todos/"):
            todo_id = int(self.path.split("/")[-1])
            todo = next((t for t in todos if t["id"] == todo_id), None)
            if todo:
                self._send_json(200, todo)
            else:
                self._send_json(404, {"error": "Not found"})
        else:
            self._send_json(404, {"error": "Unknown endpoint"})

    def do_POST(self):
        global next_id
        if self.path == "/todos":
            data = self._read_body()
            # BUG: no validation - title could be missing or empty
            todo = {
                "id": next_id,
                "title": data.get("title"),
                "completed": False
            }
            next_id += 1
            todos.append(todo)
            self._send_json(201, todo)
        else:
            self._send_json(404, {"error": "Unknown endpoint"})

    # BUG: PUT handler is completely missing
    # TODO: implement PUT /todos/:id to update a todo

    def do_DELETE(self):
        global todos
        if self.path.startswith("/todos/"):
            todo_id = int(self.path.split("/")[-1])
            # BUG: doesn't check if todo exists before deleting
            todos = [t for t in todos if t["id"] != todo_id]
            self._send_json(200, {"deleted": todo_id})
        else:
            self._send_json(404, {"error": "Unknown endpoint"})

    # Suppress default logging
    def log_message(self, format, *args):
        pass


# TODO: Add /todos/search?q=keyword endpoint
# TODO: Add /todos/stats endpoint (total, completed, pending counts)
# TODO: Add created_at timestamp to todos
# TODO: Add input validation middleware
# TODO: Write tests for all endpoints

if __name__ == "__main__":
    server = HTTPServer(("localhost", 8080), TodoHandler)
    print("Server running on http://localhost:8080")
    server.serve_forever()
