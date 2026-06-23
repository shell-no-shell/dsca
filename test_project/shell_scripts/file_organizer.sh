#!/bin/bash
# File organizer script - L1/L2 test case
# Organizes files in a directory by extension

# BUG: doesn't handle filenames with spaces
# BUG: doesn't handle files without extensions

TARGET_DIR="${1:-.}"

organize() {
    local dir="$1"

    if [ ! -d "$dir" ]; then
        echo "Error: $dir is not a directory"
        exit 1
    fi

    # BUG: doesn't handle filenames with spaces (missing quotes)
    for file in $(ls "$dir"); do
        if [ -f "$dir/$file" ]; then
            # BUG: fails for files without extension (gets filename as ext)
            ext="${file##*.}"
            mkdir -p "$dir/$ext"
            mv "$dir/$file" "$dir/$ext/"
            echo "Moved $file -> $ext/"
        fi
    done

    echo "Organization complete"
}

# TODO: implement undo() - move files back to original locations (need to track moves)
# TODO: implement dry_run() - show what would happen without moving
# TODO: implement --recursive flag to organize subdirectories
# TODO: implement file size summary per category
# TODO: implement exclude patterns (e.g., skip .git, .DS_Store)

count_by_extension() {
    local dir="$1"
    # BUG: doesn't handle hidden files, counts directories too
    for ext in $(ls "$dir" | grep -o '\.[^.]*$' | sort -u); do
        count=$(ls "$dir"/*"$ext" 2>/dev/null | wc -l)
        echo "$ext: $count files"
    done
}

case "$1" in
    organize)
        organize "${2:-.}"
        ;;
    count)
        count_by_extension "${2:-.}"
        ;;
    *)
        echo "Usage: $0 {organize|count} [directory]"
        exit 1
        ;;
esac
