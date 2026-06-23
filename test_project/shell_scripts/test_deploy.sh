#!/bin/bash
# Test script for deploy.sh
# Tests basic deploy functionality and exposes bugs

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
TEST_PASSED=0
TEST_FAILED=0

pass() { echo "  PASS: $1"; ((TEST_PASSED++)); }
fail() { echo "  FAIL: $1"; ((TEST_FAILED++)); }

cleanup() {
    rm -rf /tmp/deploy_test /tmp/deploy_backup /tmp/deploy_test.log
}

echo "=== Deploy Script Tests ==="
echo

# Setup
cleanup

# Test 1: deploy creates version file
echo "Test: deploy creates version file"
bash "$SCRIPT_DIR/deploy.sh" deploy "1.0.0"
if [ -f "/tmp/deploy_test/VERSION" ] && [ "$(cat /tmp/deploy_test/VERSION)" = "1.0.0" ]; then
    pass "deploy creates version file"
else
    fail "deploy creates version file"
fi

# Test 2: deploy creates backup on re-deploy
echo "Test: backup on re-deploy"
bash "$SCRIPT_DIR/deploy.sh" deploy "2.0.0"
if [ -d "/tmp/deploy_backup" ] && [ "$(ls /tmp/deploy_backup | wc -l)" -gt 0 ]; then
    pass "backup created on re-deploy"
else
    fail "backup created on re-deploy"
fi

# Test 3: deploy without version should fail
echo "Test: deploy without version fails"
if bash "$SCRIPT_DIR/deploy.sh" deploy 2>/dev/null; then
    fail "should fail without version"
else
    pass "fails without version"
fi

# Test 4: invalid command shows usage
echo "Test: invalid command shows usage"
output=$(bash "$SCRIPT_DIR/deploy.sh" invalid 2>&1 || true)
if echo "$output" | grep -q "Usage"; then
    pass "shows usage for invalid command"
else
    fail "shows usage for invalid command"
fi

# Cleanup
cleanup

echo
echo "=== Results: $TEST_PASSED passed, $TEST_FAILED failed ==="
[ "$TEST_FAILED" -eq 0 ] || exit 1
