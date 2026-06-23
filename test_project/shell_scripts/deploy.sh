#!/bin/bash
# Deployment script - L2 test case
# Contains bugs and missing features

set -e

APP_NAME="myapp"
DEPLOY_DIR="/tmp/deploy_test"
LOG_FILE="/tmp/deploy_test.log"
BACKUP_DIR="/tmp/deploy_backup"

# BUG: doesn't create directories if they don't exist
# BUG: doesn't check if APP_NAME is set

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" >> "$LOG_FILE"
}

# BUG: backup function doesn't check if source exists
backup() {
    local src="$1"
    local timestamp=$(date '+%Y%m%d_%H%M%S')
    cp -r "$src" "${BACKUP_DIR}/${APP_NAME}_${timestamp}"
    log "Backup created: ${BACKUP_DIR}/${APP_NAME}_${timestamp}"
}

# BUG: doesn't validate version format
check_version() {
    local version="$1"
    # Should validate semver format (x.y.z)
    echo "$version"
}

deploy() {
    local version="$1"

    if [ -z "$version" ]; then
        log "ERROR: Version not specified"
        exit 1
    fi

    log "Starting deployment of $APP_NAME v$version"

    # Step 1: backup current
    if [ -d "$DEPLOY_DIR" ]; then
        backup "$DEPLOY_DIR"
    fi

    # Step 2: create deploy directory
    mkdir -p "$DEPLOY_DIR"

    # Step 3: "deploy" (simulate)
    echo "$version" > "$DEPLOY_DIR/VERSION"
    echo "deployed_at=$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$DEPLOY_DIR/metadata.txt"

    # BUG: health check always passes
    log "Running health check..."
    local healthy=true
    if [ "$healthy" = true ]; then
        log "Health check passed"
    else
        log "ERROR: Health check failed, rolling back"
        rollback
        exit 1
    fi

    log "Deployment of $APP_NAME v$version complete"
}

# TODO: implement rollback() - restore from latest backup
# TODO: implement cleanup() - remove backups older than N days
# TODO: implement status() - show current version, last deploy time
# TODO: implement validate_env() - check required tools/env vars exist
# TODO: implement usage/help message with getopts

# BUG: no argument parsing - should use getopts or case statement
if [ "$1" = "deploy" ]; then
    deploy "$2"
elif [ "$1" = "backup" ]; then
    backup "$DEPLOY_DIR"
else
    echo "Usage: $0 {deploy|backup} [version]"
    exit 1
fi
