# DevOps Dashboard

A real-time DevOps monitoring dashboard that aggregates data from multiple sources:

## Features (Planned)
1. **System Monitor** — CPU, memory, disk usage of the local machine, updated every 5 seconds
2. **GitHub Integration** — Show recent commits, open PRs, and CI status for a configured repo
3. **Service Health Checker** — Ping a list of URLs/endpoints and show up/down status with response times
4. **Log Viewer** — Tail and search application log files with regex filtering
5. **Deployment Tracker** — Record deployments with timestamp, version, status, and rollback capability

## Tech Stack
- Backend: Python (Flask) with SQLite for deployment records
- Frontend: Single-page HTML with vanilla JS, real-time updates via SSE (Server-Sent Events)
- APIs: GitHub REST API, local system metrics via psutil

## Setup
```bash
pip install -r requirements.txt
python app.py
# Open http://localhost:5050
```

## Configuration
Copy `.env.example` to `.env` and fill in:
- `GITHUB_TOKEN` — GitHub personal access token
- `GITHUB_REPO` — Repository in format `owner/repo`
- `WATCH_URLS` — Comma-separated URLs to health-check
- `LOG_FILES` — Comma-separated paths to log files to tail
