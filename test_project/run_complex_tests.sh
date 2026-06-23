#!/bin/bash
# DSCA Complex Test Runner
# Tests dsca auto mode against 5 complex multi-language projects
# Usage: ./run_complex_tests.sh [project_number]

set -e

DSCA="node /Users/baidu/Downloads/dsca/packages/cli/dist/index.js"
BASE_DIR="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$BASE_DIR/test_results/$(date +%Y%m%d_%H%M%S)"
mkdir -p "$RESULTS_DIR"

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${YELLOW}[$(date +%H:%M:%S)]${NC} $1"; }
pass() { echo -e "${GREEN}[PASS]${NC} $1"; }
fail() { echo -e "${RED}[FAIL]${NC} $1"; }

run_dsca_test() {
    local project_dir="$1"
    local task="$2"
    local test_name="$3"
    local verify_cmd="$4"
    local project_name=$(basename "$project_dir")

    log "Testing: $test_name"
    log "  Project: $project_name"
    log "  Task: $task"

    local start_time=$(date +%s)

    # Run DSCA in auto mode
    $DSCA --confirm-all -w "$project_dir" "$task" \
        > "$RESULTS_DIR/${project_name}_${test_name}.log" 2>&1
    local dsca_exit=$?

    local end_time=$(date +%s)
    local duration=$((end_time - start_time))

    # Verify result
    if [ -n "$verify_cmd" ]; then
        log "  Verifying with: $verify_cmd"
        local verify_output
        verify_output=$(cd "$project_dir" && eval "$verify_cmd" 2>&1)
        local verify_exit=$?

        echo "$verify_output" > "$RESULTS_DIR/${project_name}_${test_name}_verify.log"

        if [ $verify_exit -eq 0 ]; then
            pass "$test_name (${duration}s)"
            echo "PASS,$test_name,$project_name,$duration,$dsca_exit" >> "$RESULTS_DIR/results.csv"
        else
            fail "$test_name (${duration}s) - verification failed"
            echo "FAIL,$test_name,$project_name,$duration,$dsca_exit" >> "$RESULTS_DIR/results.csv"
        fi
    else
        if [ $dsca_exit -eq 0 ]; then
            pass "$test_name (${duration}s)"
            echo "PASS,$test_name,$project_name,$duration,$dsca_exit" >> "$RESULTS_DIR/results.csv"
        else
            fail "$test_name (${duration}s)"
            echo "FAIL,$test_name,$project_name,$duration,$dsca_exit" >> "$RESULTS_DIR/results.csv"
        fi
    fi
}

# === Project 1: Full-Stack Task Manager (Python+TS) ===
test_project_01() {
    local dir="$BASE_DIR/complex_01_fullstack_taskmanager"

    echo ""
    echo "========================================="
    echo "Project 1: Full-Stack Task Manager"
    echo "========================================="

    # Phase 1: Fix backend tests
    run_dsca_test "$dir/backend" \
        "Run pytest test_api.py -v and fix all failing tests. The bugs include: SQL injection vulnerability, wrong pagination offset, missing priority validation, wrong HTTP status code. Do NOT change the test expectations." \
        "p1_phase1_backend_tests" \
        "python3 -m pytest test_api.py -v"

    # Phase 2: Fix frontend
    # run_dsca_test "$dir/frontend" \
    #     "Fix the TypeScript errors and make the frontend build succeed. Fix the wrong API base URL in api.ts and add missing key prop in App.tsx" \
    #     "p1_phase2_frontend" \
    #     "npx tsc --noEmit"
}

# === Project 2: Distributed KV Store (Go) ===
test_project_02() {
    local dir="$BASE_DIR/complex_02_distributed_kv"

    echo ""
    echo "========================================="
    echo "Project 2: Distributed KV Store (Go)"
    echo "========================================="

    # Phase 1: Fix Raft tests
    run_dsca_test "$dir" \
        "Run go test ./internal/raft/... -v and fix all failing tests. The bugs are in raft.go: HandleRequestVote doesn't check log freshness, HandleAppendEntries doesn't verify prevLogTerm, conflicting entries aren't replaced, and StartElection doesn't count self-vote. Do NOT change the tests." \
        "p2_phase1_raft_tests" \
        "go test ./internal/raft/... -v"

    # Phase 1b: Fix store race conditions
    run_dsca_test "$dir" \
        "Run go test -race ./internal/store/... and fix all race conditions. Add proper mutex locking to the KVStore struct. Also fix the TTL expiration check in Get(). Do NOT change the tests." \
        "p2_phase1_store_race" \
        "go test -race ./internal/store/... -v"
}

# === Project 3: Compiler Frontend (Rust) ===
test_project_03() {
    local dir="$BASE_DIR/complex_03_compiler_frontend"

    echo ""
    echo "========================================="
    echo "Project 3: Compiler Frontend (Rust)"
    echo "========================================="

    # Phase 1: Fix lexer and parser
    run_dsca_test "$dir" \
        "Run cargo test and fix all failing tests. Key bugs: 1) lexer.rs doesn't handle \\r escape and doesn't error on unknown escapes, 2) lexer number parsing treats '123.abc' as float, 3) parser.rs has wrong operator precedence - && should bind tighter than ||. Do NOT change the tests." \
        "p3_phase1_lexer_parser" \
        "cargo test"
}

# === Project 4: Analytics Pipeline (Python) ===
test_project_04() {
    local dir="$BASE_DIR/complex_04_analytics_pipeline"

    echo ""
    echo "========================================="
    echo "Project 4: Analytics Pipeline (Python)"
    echo "========================================="

    # Phase 1: Fix pipeline tests
    run_dsca_test "$dir" \
        "Run python3 -m pytest processing/test_pipeline.py -v and fix all failing tests. Bugs include: 1) schema.py doesn't validate event_type against VALID_EVENT_TYPES, 2) schema.py doesn't check properties is a dict, 3) aggregator.py EventEnricher crashes on None/missing properties, 4) aggregator.py enricher mutates original event, 5) aggregator.py timezone handling doesn't normalize to UTC, 6) dashboard/app.py has XSS - needs HTML escaping. Do NOT change the tests." \
        "p4_phase1_pipeline" \
        "python3 -m pytest processing/test_pipeline.py -v"
}

# === Project 5: Kernel Module (C) ===
test_project_05() {
    local dir="$BASE_DIR/complex_05_kernel_module"

    echo ""
    echo "========================================="
    echo "Project 5: Kernel Module (C)"
    echo "========================================="

    # Phase 1: Fix allocator coalescing
    run_dsca_test "$dir" \
        "Run 'make clean && make all && make test'. Fix the failing test_fragmentation_recovery test. The bug is in allocator.c: the buddy coalescing in allocator_free has a 'break' that prevents recursive coalescing. Remove the premature break so buddies keep merging up the tree. Also fix the compiler warning about unused variable. Do NOT change the tests." \
        "p5_phase1_allocator" \
        "make clean && make all && make test"
}

# === Main ===
echo "DSCA Complex Project Test Suite"
echo "================================"
echo "Results will be saved to: $RESULTS_DIR"
echo ""

# CSV header
echo "status,test_name,project,duration_sec,dsca_exit" > "$RESULTS_DIR/results.csv"

if [ -n "$1" ]; then
    # Run specific project
    test_project_0$1
else
    # Run all projects
    test_project_01
    test_project_02
    test_project_03
    test_project_04
    test_project_05
fi

echo ""
echo "========================================="
echo "Test Results Summary"
echo "========================================="
echo ""

total=$(grep -c "," "$RESULTS_DIR/results.csv" 2>/dev/null || echo 0)
total=$((total - 1))  # subtract header
passed=$(grep -c "^PASS" "$RESULTS_DIR/results.csv" 2>/dev/null || echo 0)
failed=$(grep -c "^FAIL" "$RESULTS_DIR/results.csv" 2>/dev/null || echo 0)

echo "Total: $total | Passed: $passed | Failed: $failed"
echo ""
cat "$RESULTS_DIR/results.csv" | column -t -s,
echo ""
echo "Full logs: $RESULTS_DIR/"
