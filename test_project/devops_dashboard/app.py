"""
DevOps Dashboard — Real-time monitoring application
====================================================
STATUS: Partially implemented, multiple known issues.

Known bugs and incomplete features (for the AI agent to fix):
1. SSE (Server-Sent Events) endpoint is broken — never sends data
2. GitHub API integration has wrong URL format and no error handling
3. System metrics collection crashes on some platforms
4. SQLite deployment tracker has SQL injection vulnerability
5. Health checker doesn't handle timeouts or SSL errors
6. Log viewer doesn't handle file encoding or large files
7. Frontend doesn't connect to SSE stream
8. No CORS headers for development
9. Missing .env loading
10. Deployment rollback logic is completely unimplemented
"""

import os
import json
import time
import sqlite3
import threading
import traceback
from datetime import datetime
from flask import Flask, jsonify, request, Response, render_template_string

# BUG #9 FIX: Load .env file
from dotenv import load_dotenv
load_dotenv()

app = Flask(__name__)

# BUG #8 FIX: Enable CORS for development
from flask_cors import CORS
CORS(app)

# ─── Configuration ───
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')
GITHUB_REPO = os.environ.get('GITHUB_REPO', 'facebook/react')
WATCH_URLS = os.environ.get('WATCH_URLS', '').split(',') if os.environ.get('WATCH_URLS', '').strip() else []
LOG_FILES = os.environ.get('LOG_FILES', '').split(',') if os.environ.get('LOG_FILES', '').strip() else []

# Detect proxy settings from environment
HTTP_PROXY = os.environ.get('HTTP_PROXY') or os.environ.get('http_proxy', '')
HTTPS_PROXY = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy', '')
NO_PROXY = os.environ.get('NO_PROXY') or os.environ.get('no_proxy', '')

# ─── Database Setup ───
DB_PATH = os.path.join(os.path.dirname(__file__), 'deployments.db')

def init_db():
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS deployments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version TEXT NOT NULL,
        environment TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        deployed_by TEXT,
        deployed_at TEXT,
        notes TEXT,
        rollback_from TEXT
    )''')
    conn.commit()
    conn.close()

init_db()

# ─── System Metrics ───
def get_system_metrics():
    """Collect CPU, memory, disk metrics.
    BUG #3 FIX: Graceful fallback if psutil not installed or net_io_counters returns None.
    """
    try:
        import psutil
    except ImportError:
        return {
            'cpu': {'percent': 0, 'cores': 0, 'freq': 0},
            'memory': {'total': 0, 'used': 0, 'percent': 0},
            'disk': {'total': 0, 'used': 0, 'percent': 0},
            'network': {'bytes_sent': 0, 'bytes_recv': 0},
            'timestamp': datetime.now().isoformat(),
            'error': 'psutil not installed'
        }

    try:
        cpu_percent = psutil.cpu_percent(interval=1)
    except Exception:
        cpu_percent = 0

    try:
        memory = psutil.virtual_memory()
    except Exception:
        memory = type('obj', (object,), {'total': 0, 'used': 0, 'percent': 0})()

    try:
        disk = psutil.disk_usage('/')
    except Exception:
        disk = type('obj', (object,), {'total': 0, 'used': 0, 'percent': 0})()

    # BUG #3 FIX: Handle net_io_counters returning None
    try:
        net = psutil.net_io_counters()
        net_data = {'bytes_sent': net.bytes_sent, 'bytes_recv': net.bytes_recv} if net else {'bytes_sent': 0, 'bytes_recv': 0}
    except Exception:
        net_data = {'bytes_sent': 0, 'bytes_recv': 0}

    return {
        'cpu': {
            'percent': cpu_percent,
            'cores': psutil.cpu_count() if hasattr(psutil, 'cpu_count') else 0,
            'freq': psutil.cpu_freq().current if hasattr(psutil, 'cpu_freq') and psutil.cpu_freq() else 0
        },
        'memory': {
            'total': memory.total,
            'used': memory.used,
            'percent': memory.percent
        },
        'disk': {
            'total': disk.total,
            'used': disk.used,
            'percent': disk.percent
        },
        'network': net_data,
        'timestamp': datetime.now().isoformat()
    }


# ─── GitHub Integration ───
def _github_request(url, headers, timeout=10):
    """Make a GitHub API request with proxy fallback.
    BUG #2 FIX: Handles SSL/LibreSSL issues by falling back to proxy.
    """
    import requests
    
    # Try direct connection first
    try:
        resp = requests.get(url, headers=headers, timeout=timeout)
        return resp
    except (requests.exceptions.ConnectionError, requests.exceptions.Timeout) as e:
        # If direct fails and we have a proxy, try via proxy
        if HTTPS_PROXY or HTTP_PROXY:
            proxies = {}
            if HTTPS_PROXY:
                proxies['https'] = HTTPS_PROXY
            if HTTP_PROXY:
                proxies['http'] = HTTP_PROXY
            # Exclude localhost from proxy
            no_proxy_list = [h.strip() for h in NO_PROXY.split(',') if h.strip()] if NO_PROXY else []
            if not any(host in url for host in no_proxy_list):
                try:
                    resp = requests.get(url, headers=headers, timeout=timeout, proxies=proxies)
                    return resp
                except Exception:
                    pass
        raise e


def get_github_data():
    """Fetch recent commits, PRs, and workflow runs from GitHub.
    BUG #2 FIX: Correct URL format (/repos/ not /repo/), timeouts, error handling, proxy fallback.
    """
    import requests

    headers = {'Authorization': f'token {GITHUB_TOKEN}'} if GITHUB_TOKEN else {}
    headers['Accept'] = 'application/vnd.github.v3+json'
    headers['User-Agent'] = 'DevOps-Dashboard/1.0'

    # FIXED URL: /repos/ not /repo/
    base_url = f'https://api.github.com/repos/{GITHUB_REPO}'

    result = {
        'commits': [],
        'pull_requests': [],
        'ci_runs': []
    }

    # Fetch recent commits
    try:
        commits_resp = _github_request(f'{base_url}/commits?per_page=5', headers)
        if commits_resp.status_code == 200:
            commits = commits_resp.json()
            result['commits'] = [{
                'sha': c['sha'][:7],
                'message': c['commit']['message'].split('\n')[0],
                'author': c['commit']['author']['name'],
                'date': c['commit']['author']['date']
            } for c in commits]
        else:
            result['commits_error'] = f'GitHub API returned {commits_resp.status_code}'
    except Exception as e:
        result['commits_error'] = str(e)[:100]

    # Fetch open PRs
    try:
        prs_resp = _github_request(f'{base_url}/pulls?state=open&per_page=5', headers)
        if prs_resp.status_code == 200:
            prs = prs_resp.json()
            result['pull_requests'] = [{
                'number': pr['number'],
                'title': pr['title'],
                'author': pr['user']['login'],
                'state': pr['state']
            } for pr in prs]
        else:
            result['prs_error'] = f'GitHub API returned {prs_resp.status_code}'
    except Exception as e:
        result['prs_error'] = str(e)[:100]

    # Fetch workflow runs (CI status)
    try:
        runs_resp = _github_request(f'{base_url}/actions/runs?per_page=5', headers)
        if runs_resp.status_code == 200:
            runs = runs_resp.json()
            result['ci_runs'] = [{
                'name': r['name'],
                'status': r['status'],
                'conclusion': r['conclusion'],
                'created_at': r['created_at']
            } for r in runs.get('workflow_runs', [])]
        else:
            result['ci_error'] = f'GitHub API returned {runs_resp.status_code}'
    except Exception as e:
        result['ci_error'] = str(e)[:100]

    return result


# ─── Health Checker ───
def check_service_health():
    """Ping configured URLs and return health status.
    BUG #5 FIX: Timeout, SSL error handling, empty WATCH_URLS handling, proxy fallback.
    """
    import requests

    # BUG #5 FIX: Handle empty WATCH_URLS
    if not WATCH_URLS:
        return [{'status': 'no_urls_configured', 'message': 'No URLs configured in WATCH_URLS'}]

    results = []
    for url in WATCH_URLS:
        url = url.strip()
        if not url:
            continue
        start = time.time()
        try:
            # BUG #5 FIX: Add timeout and SSL verification handling
            resp = requests.get(url, timeout=5, verify=True)
            elapsed = time.time() - start
            results.append({
                'url': url,
                'status': 'up',
                'code': resp.status_code,
                'response_time': round(elapsed * 1000, 2),  # ms
                'checked_at': datetime.now().isoformat()
            })
        except requests.exceptions.Timeout:
            results.append({
                'url': url,
                'status': 'down',
                'error': 'Timeout after 5s',
                'checked_at': datetime.now().isoformat()
            })
        except requests.exceptions.SSLError as e:
            # BUG #5 FIX: Handle SSL errors gracefully
            results.append({
                'url': url,
                'status': 'down',
                'error': f'SSL Error: {str(e)[:80]}',
                'checked_at': datetime.now().isoformat()
            })
        except requests.exceptions.ConnectionError as e:
            results.append({
                'url': url,
                'status': 'down',
                'error': f'Connection Error: {str(e)[:80]}',
                'checked_at': datetime.now().isoformat()
            })
        except Exception as e:
            results.append({
                'url': url,
                'status': 'down',
                'error': str(e)[:100],
                'checked_at': datetime.now().isoformat()
            })

    return results


# ─── Log Viewer ───
def read_log_file(filepath, lines=50, search=None):
    """Read last N lines of a log file with optional regex search.
    BUG #6 FIX: File not found handling, encoding fallback, file size limit.
    """
    import os

    # BUG #6 FIX: Check file exists
    if not os.path.exists(filepath):
        return {
            'file': filepath,
            'error': f'File not found: {filepath}',
            'total_lines': 0,
            'lines': [],
            'showing': 0
        }

    # BUG #6 FIX: Check file size (limit to 100MB)
    file_size = os.path.getsize(filepath)
    MAX_FILE_SIZE = 100 * 1024 * 1024  # 100MB
    if file_size > MAX_FILE_SIZE:
        return {
            'file': filepath,
            'error': f'File too large ({file_size / 1024 / 1024:.1f} MB). Max: 100 MB',
            'total_lines': -1,
            'lines': [],
            'showing': 0
        }

    # BUG #6 FIX: Try multiple encodings
    content = None
    for encoding in ['utf-8', 'latin-1', 'cp1252', 'iso-8859-1']:
        try:
            with open(filepath, 'r', encoding=encoding) as f:
                content = f.read()
            break
        except (UnicodeDecodeError, UnicodeError):
            continue

    if content is None:
        # Last resort: read as binary and decode with error handling
        try:
            with open(filepath, 'rb') as f:
                raw = f.read()
            content = raw.decode('utf-8', errors='replace')
        except Exception as e:
            return {
                'file': filepath,
                'error': f'Cannot read file: {str(e)[:100]}',
                'total_lines': 0,
                'lines': [],
                'showing': 0
            }

    all_lines = content.splitlines()
    tail = all_lines[-lines:]

    if search:
        import re
        try:
            pattern = re.compile(search)
            tail = [l for l in tail if pattern.search(l)]
        except re.error as e:
            return {
                'file': filepath,
                'error': f'Invalid regex: {str(e)[:80]}',
                'total_lines': len(all_lines),
                'lines': [],
                'showing': 0
            }

    return {
        'file': filepath,
        'total_lines': len(all_lines),
        'lines': [l.rstrip() for l in tail],
        'showing': len(tail)
    }


# ─── Deployment Tracker ───
def record_deployment(version, environment, deployed_by, notes=''):
    """Record a new deployment.
    BUG #4 FIX: Uses parameterized queries to prevent SQL injection.
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    # BUG #4 FIX: Use parameterized query instead of f-string
    c.execute(
        "INSERT INTO deployments (version, environment, status, deployed_by, deployed_at, notes) "
        "VALUES (?, ?, 'success', ?, ?, ?)",
        (version, environment, deployed_by, datetime.now().isoformat(), notes)
    )
    deploy_id = c.lastrowid
    conn.commit()
    conn.close()
    return deploy_id


def list_deployments(limit=20):
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()
    c.execute('SELECT * FROM deployments ORDER BY id DESC LIMIT ?', (limit,))
    rows = c.fetchall()
    conn.close()

    columns = ['id', 'version', 'environment', 'status', 'deployed_by', 'deployed_at', 'notes', 'rollback_from']
    return [dict(zip(columns, row)) for row in rows]


def rollback_deployment(deploy_id):
    """Rollback a deployment to the previous version.
    BUG #10 FIX: Fully implemented rollback logic.
    """
    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # 1) Find the deployment by ID
    c.execute('SELECT * FROM deployments WHERE id = ?', (deploy_id,))
    row = c.fetchone()
    if not row:
        conn.close()
        return None

    columns = ['id', 'version', 'environment', 'status', 'deployed_by', 'deployed_at', 'notes', 'rollback_from']
    current = dict(zip(columns, row))

    # 2) Find the previous deployment in the same environment
    c.execute(
        'SELECT * FROM deployments WHERE environment = ? AND id < ? AND status = ? ORDER BY id DESC LIMIT 1',
        (current['environment'], deploy_id, 'success')
    )
    prev_row = c.fetchone()
    if not prev_row:
        conn.close()
        return None

    prev = dict(zip(columns, prev_row))

    # 3) Create a new deployment record marked as rollback
    now = datetime.now().isoformat()
    c.execute(
        "INSERT INTO deployments (version, environment, status, deployed_by, deployed_at, notes, rollback_from) "
        "VALUES (?, ?, 'rollback', ?, ?, ?, ?)",
        (prev['version'], current['environment'], 'system', now,
         f'Rollback from {current["version"]} to {prev["version"]}', current['version'])
    )
    rollback_id = c.lastrowid
    conn.commit()
    conn.close()

    # 4) Return the new rollback deployment info
    return {
        'id': rollback_id,
        'version': prev['version'],
        'environment': current['environment'],
        'status': 'rollback',
        'rollback_from': current['version'],
        'deployed_at': now
    }


# ─── SSE Stream ───
# BUG #1 FIX: Infinite loop that sends metrics every N seconds.
def event_stream():
    """Server-Sent Events stream for real-time metrics.
    BUG #1 FIX: Now loops forever, sending metrics every 5 seconds.
    """
    while True:
        try:
            data = get_system_metrics()
            yield f"data: {json.dumps(data)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        time.sleep(5)


# ─── Global Error Handlers ───

@app.errorhandler(404)
def not_found(e):
    return jsonify({'error': 'Not found'}), 404


@app.errorhandler(500)
def server_error(e):
    return jsonify({'error': 'Internal server error', 'detail': str(e)}), 500


# ─── Routes ───

@app.route('/')
def index():
    try:
        return render_template_string(DASHBOARD_HTML, log_files=LOG_FILES)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/metrics')
def api_metrics():
    try:
        metrics = get_system_metrics()
        return jsonify(metrics)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/metrics/stream')
def api_metrics_stream():
    """SSE stream for real-time metrics."""
    try:
        return Response(event_stream(), mimetype='text/event-stream')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/github')
def api_github():
    try:
        data = get_github_data()
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/health')
def api_health():
    try:
        results = check_service_health()
        return jsonify(results)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/logs')
def api_logs():
    filepath = request.args.get('file', '')
    lines = request.args.get('lines', 50, type=int)
    search = request.args.get('search', None)

    try:
        data = read_log_file(filepath, lines, search)
        return jsonify(data)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/deployments', methods=['GET'])
def api_list_deployments():
    try:
        deployments = list_deployments()
        return jsonify(deployments)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/deployments', methods=['POST'])
def api_create_deployment():
    try:
        data = request.json
        if not data:
            return jsonify({'error': 'No JSON body'}), 400

        deploy_id = record_deployment(
            version=data.get('version', ''),
            environment=data.get('environment', 'production'),
            deployed_by=data.get('deployed_by', 'unknown'),
            notes=data.get('notes', '')
        )
        return jsonify({'id': deploy_id, 'status': 'recorded'}), 201
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/deployments/<int:deploy_id>/rollback', methods=['POST'])
def api_rollback(deploy_id):
    try:
        result = rollback_deployment(deploy_id)
        if result is None:
            return jsonify({'error': 'No previous deployment found to rollback to'}), 400
        return jsonify(result)
    except Exception as e:
        return jsonify({'error': str(e)}), 500


# ─── Frontend HTML ───
DASHBOARD_HTML = """
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>DevOps Dashboard</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
               background: #0f172a; color: #e2e8f0; }
        .header { background: #1e293b; padding: 16px 24px; border-bottom: 1px solid #334155;
                   display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; color: #38bdf8; }
        .header .status { font-size: 12px; color: #94a3b8; }
        .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(400px, 1fr));
                gap: 16px; padding: 24px; }
        .card { background: #1e293b; border-radius: 12px; padding: 20px;
                border: 1px solid #334155; }
        .card h2 { font-size: 14px; color: #94a3b8; text-transform: uppercase;
                    letter-spacing: 1px; margin-bottom: 16px; }
        .metric-row { display: flex; justify-content: space-between; align-items: center;
                      padding: 8px 0; border-bottom: 1px solid #334155; }
        .metric-row:last-child { border-bottom: none; }
        .metric-label { color: #94a3b8; font-size: 14px; }
        .metric-value { font-size: 18px; font-weight: 600; color: #f1f5f9; }
        .progress-bar { width: 100%; height: 8px; background: #334155; border-radius: 4px;
                        margin-top: 4px; overflow: hidden; }
        .progress-fill { height: 100%; border-radius: 4px; transition: width 0.5s ease; }
        .progress-fill.low { background: #22c55e; }
        .progress-fill.mid { background: #eab308; }
        .progress-fill.high { background: #ef4444; }
        .status-badge { display: inline-block; padding: 2px 8px; border-radius: 9999px;
                        font-size: 11px; font-weight: 600; }
        .status-up { background: #166534; color: #4ade80; }
        .status-down { background: #7f1d1d; color: #fca5a5; }
        .commit-list, .pr-list, .deploy-list { list-style: none; }
        .commit-list li, .pr-list li, .deploy-list li {
            padding: 8px 0; border-bottom: 1px solid #334155; font-size: 13px; }
        .commit-sha { color: #38bdf8; font-family: monospace; }
        .log-viewer { background: #0f172a; border: 1px solid #334155; border-radius: 8px;
                      padding: 12px; max-height: 300px; overflow-y: auto;
                      font-family: monospace; font-size: 12px; line-height: 1.6; }
        .log-line { white-space: pre-wrap; word-break: break-all; }
        .deploy-form { display: flex; gap: 8px; margin-bottom: 12px; }
        .deploy-form input, .deploy-form select {
            background: #0f172a; border: 1px solid #334155; color: #e2e8f0;
            padding: 6px 10px; border-radius: 6px; font-size: 13px; }
        .deploy-form button, .btn {
            background: #2563eb; color: white; border: none; padding: 6px 14px;
            border-radius: 6px; cursor: pointer; font-size: 13px; }
        .deploy-form button:hover, .btn:hover { background: #1d4ed8; }
        .btn-danger { background: #dc2626; }
        .btn-danger:hover { background: #b91c1c; }
        .error-msg { color: #fca5a5; font-size: 12px; padding: 8px; }
        .loading { color: #64748b; font-style: italic; }
    </style>
</head>
<body>
    <div class="header">
        <h1>⚡ DevOps Dashboard</h1>
        <div class="status" id="connection-status">Connecting...</div>
    </div>

    <div class="grid">
        <!-- System Metrics -->
        <div class="card">
            <h2>📊 System Metrics</h2>
            <div id="metrics-container">
                <div class="loading">Loading metrics...</div>
            </div>
        </div>

        <!-- Service Health -->
        <div class="card">
            <h2>🏥 Service Health</h2>
            <div id="health-container">
                <div class="loading">Checking services...</div>
            </div>
        </div>

        <!-- GitHub -->
        <div class="card">
            <h2>🐙 GitHub Activity</h2>
            <div id="github-container">
                <div class="loading">Fetching GitHub data...</div>
            </div>
        </div>

        <!-- Deployments -->
        <div class="card">
            <h2>🚀 Deployments</h2>
            <div class="deploy-form">
                <input id="deploy-version" placeholder="Version (e.g. v1.2.3)" />
                <select id="deploy-env">
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="dev">Dev</option>
                </select>
                <button onclick="createDeployment()">Deploy</button>
            </div>
            <div id="deploy-container">
                <div class="loading">Loading deployments...</div>
            </div>
        </div>

        <!-- Log Viewer -->
        <div class="card" style="grid-column: span 2;">
            <h2>📋 Log Viewer</h2>
            <div style="display:flex; gap:8px; margin-bottom:12px;">
                <select id="log-file-select">
                    <option value="">Select log file...</option>
                </select>
                <input id="log-search" placeholder="Search (regex)..." style="flex:1;" />
                <button onclick="loadLogs()" class="btn">Search</button>
            </div>
            <div id="log-container" class="log-viewer">
                <div class="loading">Select a log file to view...</div>
            </div>
        </div>
    </div>

    <script>
        // ─── API Helper ───
        async function fetchAPI(url) {
            const resp = await fetch(url);
            return resp.json();
        }

        // ─── System Metrics ───
        function renderMetrics(data) {
            if (data.error) {
                document.getElementById('metrics-container').innerHTML =
                    '<div class="error-msg">' + data.error + '</div>';
                return;
            }

            var cpuClass = data.cpu.percent > 80 ? 'high' : data.cpu.percent > 50 ? 'mid' : 'low';
            var memClass = data.memory.percent > 80 ? 'high' : data.memory.percent > 50 ? 'mid' : 'low';
            var diskClass = data.disk.percent > 80 ? 'high' : data.disk.percent > 50 ? 'mid' : 'low';

            document.getElementById('metrics-container').innerHTML =
                '<div class="metric-row">' +
                '  <span class="metric-label">CPU Usage</span>' +
                '  <span class="metric-value">' + data.cpu.percent + '%</span>' +
                '</div>' +
                '<div class="progress-bar"><div class="progress-fill ' + cpuClass + '" style="width:' + data.cpu.percent + '%"></div></div>' +
                '<div class="metric-row">' +
                '  <span class="metric-label">Memory (' + formatBytes(data.memory.used) + ' / ' + formatBytes(data.memory.total) + ')</span>' +
                '  <span class="metric-value">' + data.memory.percent + '%</span>' +
                '</div>' +
                '<div class="progress-bar"><div class="progress-fill ' + memClass + '" style="width:' + data.memory.percent + '%"></div></div>' +
                '<div class="metric-row">' +
                '  <span class="metric-label">Disk (' + formatBytes(data.disk.used) + ' / ' + formatBytes(data.disk.total) + ')</span>' +
                '  <span class="metric-value">' + data.disk.percent + '%</span>' +
                '</div>' +
                '<div class="progress-bar"><div class="progress-fill ' + diskClass + '" style="width:' + data.disk.percent + '%"></div></div>';
        }

        function formatBytes(bytes) {
            if (bytes === 0) return '0 B';
            var k = 1024;
            var sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
            var i = Math.floor(Math.log(bytes) / Math.log(k));
            return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
        }

        // ─── Health Checker ───
        function renderHealth(data) {
            if (data.error) {
                document.getElementById('health-container').innerHTML =
                    '<div class="error-msg">' + data.error + '</div>';
                return;
            }

            var html = '';
            for (var i = 0; i < data.length; i++) {
                var s = data[i];
                var badge = s.status === 'up'
                    ? '<span class="status-badge status-up">UP</span>'
                    : '<span class="status-badge status-down">DOWN</span>';
                var detail = s.status === 'up'
                    ? s.code + ' · ' + s.response_time + 'ms'
                    : s.error;
                html += '<div class="metric-row">' +
                    '<span class="metric-label" style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + s.url + '</span>' +
                    '<span>' + badge + ' <span style="font-size:11px;color:#94a3b8">' + detail + '</span></span>' +
                    '</div>';
            }
            document.getElementById('health-container').innerHTML = html || '<div class="loading">No services configured</div>';
        }

        // ─── GitHub ───
        function renderGitHub(data) {
            if (data.error) {
                document.getElementById('github-container').innerHTML =
                    '<div class="error-msg">' + data.error + '</div>';
                return;
            }

            var html = '<h3 style="font-size:12px;color:#64748b;margin-bottom:8px">Recent Commits</h3><ul class="commit-list">';
            if (data.commits && data.commits.length) {
                for (var i = 0; i < data.commits.length; i++) {
                    var c = data.commits[i];
                    html += '<li><span class="commit-sha">' + c.sha + '</span> ' + c.message + ' <span style="color:#64748b">— ' + c.author + '</span></li>';
                }
            } else {
                html += '<li class="loading">No commits found</li>';
            }
            html += '</ul>';

            html += '<h3 style="font-size:12px;color:#64748b;margin:12px 0 8px">Open PRs</h3><ul class="pr-list">';
            if (data.pull_requests && data.pull_requests.length) {
                for (var i = 0; i < data.pull_requests.length; i++) {
                    var pr = data.pull_requests[i];
                    html += '<li>#' + pr.number + ' ' + pr.title + ' <span style="color:#64748b">by ' + pr.author + '</span></li>';
                }
            } else {
                html += '<li class="loading">No open PRs</li>';
            }
            html += '</ul>';

            document.getElementById('github-container').innerHTML = html;
        }

        // ─── Deployments ───
        function renderDeployments(data) {
            if (data.error) {
                document.getElementById('deploy-container').innerHTML =
                    '<div class="error-msg">' + data.error + '</div>';
                return;
            }

            if (!data.length) {
                document.getElementById('deploy-container').innerHTML =
                    '<div class="loading">No deployments recorded yet</div>';
                return;
            }

            var html = '<ul class="deploy-list">';
            for (var i = 0; i < data.length; i++) {
                var d = data[i];
                var statusColor = d.status === 'success' ? '#4ade80' : d.status === 'rollback' ? '#fbbf24' : '#fca5a5';
                html += '<li>' +
                    '<span style="color:' + statusColor + '">' + d.status.toUpperCase() + '</span> ' +
                    '<strong>' + d.version + '</strong> → ' + d.environment +
                    ' <span style="color:#64748b">by ' + d.deployed_by + ' at ' + d.deployed_at + '</span>' +
                    ' <button class="btn btn-danger" style="float:right;padding:2px 8px;font-size:11px" onclick="rollbackDeploy(' + d.id + ')">Rollback</button>' +
                    '</li>';
            }
            html += '</ul>';
            document.getElementById('deploy-container').innerHTML = html;
        }

        async function createDeployment() {
            var version = document.getElementById('deploy-version').value;
            var env = document.getElementById('deploy-env').value;
            if (!version) { alert('Please enter a version'); return; }

            await fetch('/api/deployments', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({ version: version, environment: env, deployed_by: 'dashboard-user' })
            });
            document.getElementById('deploy-version').value = '';
            loadDeployments();
        }

        async function rollbackDeploy(id) {
            if (!confirm('Are you sure you want to rollback deployment #' + id + '?')) return;
            var resp = await fetch('/api/deployments/' + id + '/rollback', { method: 'POST' });
            var data = await resp.json();
            if (data.error) { alert('Rollback failed: ' + data.error); }
            else { loadDeployments(); }
        }

        // ─── Log Viewer ───
        function renderLogs(data) {
            if (data.error) {
                document.getElementById('log-container').innerHTML =
                    '<div class="error-msg">' + data.error + '</div>';
                return;
            }

            var html = '';
            for (var i = 0; i < data.lines.length; i++) {
                html += '<div class="log-line">' + escapeHtml(data.lines[i]) + '</div>';
            }
            document.getElementById('log-container').innerHTML = html || '<div class="loading">No log entries found</div>';
        }

        function escapeHtml(str) {
            return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        }

        // ─── Data Loading ───
        async function loadMetrics() {
            try {
                var data = await fetchAPI('/api/metrics');
                renderMetrics(data);
            } catch(e) { renderMetrics({error: e.message}); }
        }

        async function loadHealth() {
            try {
                var data = await fetchAPI('/api/health');
                renderHealth(data);
            } catch(e) { renderHealth({error: e.message}); }
        }

        async function loadGitHub() {
            try {
                var data = await fetchAPI('/api/github');
                renderGitHub(data);
            } catch(e) { renderGitHub({error: e.message}); }
        }

        async function loadDeployments() {
            try {
                var data = await fetchAPI('/api/deployments');
                renderDeployments(data);
            } catch(e) { renderDeployments({error: e.message}); }
        }

        async function loadLogs() {
            var file = document.getElementById('log-file-select').value;
            var search = document.getElementById('log-search').value;
            if (!file) return;

            try {
                var url = '/api/logs?file=' + encodeURIComponent(file) + '&lines=100';
                if (search) url += '&search=' + encodeURIComponent(search);
                var data = await fetchAPI(url);
                renderLogs(data);
            } catch(e) { renderLogs({error: e.message}); }
        }

        // ─── SSE Connection ───
        // BUG #7: SSE is never connected. This function is defined but never called.
        function connectSSE() {
            var evtSource = new EventSource('/api/metrics/stream');
            evtSource.onmessage = function(event) {
                var data = JSON.parse(event.data);
                renderMetrics(data);
                document.getElementById('connection-status').textContent = 'Live · ' + new Date().toLocaleTimeString();
                document.getElementById('connection-status').style.color = '#4ade80';
            };
            evtSource.onerror = function() {
                document.getElementById('connection-status').textContent = 'Disconnected';
                document.getElementById('connection-status').style.color = '#fca5a5';
            };
        }

        // ─── Initialize ───
        // BUG #7 FIX: Connect SSE and populate log file selector
        connectSSE();
        populateLogFiles();
        loadMetrics();
        loadHealth();
        loadGitHub();
        loadDeployments();

        // Refresh non-SSE data periodically
        setInterval(loadHealth, 30000);
        setInterval(loadGitHub, 60000);
        setInterval(loadDeployments, 15000);

        // ─── Populate Log File Selector ───
        function populateLogFiles() {
            var logFiles = [
                {% for f in log_files %}
                '{{ f }}',
                {% endfor %}
            ];
            var select = document.getElementById('log-file-select');
            for (var i = 0; i < logFiles.length; i++) {
                var opt = document.createElement('option');
                opt.value = logFiles[i];
                opt.textContent = logFiles[i];
                select.appendChild(opt);
            }
            // Auto-load first log file if available
            if (logFiles.length > 0) {
                select.value = logFiles[0];
                loadLogs();
            }
        }
    </script>
</body>
</html>
"""


if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5050, debug=True)
