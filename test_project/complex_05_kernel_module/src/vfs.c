#include "vfs.h"
#include <string.h>
#include <stdlib.h>
#include <stdio.h>

int vfs_init(VFS *fs) {
    memset(fs, 0, sizeof(VFS));
    fs->next_inode = 1;

    /* Create root directory */
    VFSNode *root = &fs->nodes[0];
    root->inode = 0;
    strcpy(root->name, "/");
    root->type = FILE_TYPE_DIRECTORY;
    root->permissions = 0755;
    root->created_at = time(NULL);
    root->modified_at = time(NULL);
    root->parent_inode = 0;
    root->child_count = 0;
    fs->node_count = 1;

    return 0;
}

/* Find a node by splitting path components */
int vfs_resolve(VFS *fs, const char *path) {
    if (path == NULL || path[0] != '/') {
        return -1;
    }
    if (strcmp(path, "/") == 0) {
        return 0;
    }

    /* BUG 1: Buffer overflow - path_copy has no bounds check */
    char path_copy[MAX_PATH];
    /* BUG: No check that strlen(path) < MAX_PATH */
    strcpy(path_copy, path);  /* Potential buffer overflow */

    /* BUG 2: Path traversal - doesn't handle ".." components */
    /* An attacker could use "/../../../etc/passwd" to escape */

    int current = 0; /* Start from root */
    char *token = strtok(path_copy, "/");

    while (token != NULL) {
        int found = 0;
        VFSNode *dir = &fs->nodes[current];

        if (dir->type != FILE_TYPE_DIRECTORY) {
            return -1;
        }

        for (uint32_t i = 0; i < dir->child_count; i++) {
            uint32_t child_idx = dir->children[i];
            /* BUG 3: Off-by-one - should check child_idx < fs->node_count */
            if (child_idx <= fs->node_count &&
                strcmp(fs->nodes[child_idx].name, token) == 0) {
                current = child_idx;
                found = 1;
                break;
            }
        }

        if (!found) {
            return -1;
        }

        token = strtok(NULL, "/");
    }

    return current;
}

int vfs_create(VFS *fs, const char *path, FileType type, uint32_t permissions) {
    if (fs->node_count >= MAX_FILES) {
        return -1;
    }

    /* Find parent directory */
    char parent_path[MAX_PATH];
    char filename[MAX_FILENAME];

    /* Extract parent path and filename */
    strncpy(parent_path, path, MAX_PATH - 1);
    parent_path[MAX_PATH - 1] = '\0';

    char *last_slash = strrchr(parent_path, '/');
    if (last_slash == NULL) {
        return -1;
    }

    /* BUG 4: Filename extraction doesn't handle root-level files correctly */
    strncpy(filename, last_slash + 1, MAX_FILENAME - 1);
    filename[MAX_FILENAME - 1] = '\0';

    if (last_slash == parent_path) {
        parent_path[1] = '\0'; /* Root directory */
    } else {
        *last_slash = '\0';
    }

    int parent_idx = vfs_resolve(fs, parent_path);
    if (parent_idx < 0) {
        return -1;
    }

    VFSNode *parent = &fs->nodes[parent_idx];
    if (parent->type != FILE_TYPE_DIRECTORY) {
        return -1;
    }

    /* Check for duplicate */
    for (uint32_t i = 0; i < parent->child_count; i++) {
        if (strcmp(fs->nodes[parent->children[i]].name, filename) == 0) {
            return -2; /* Already exists */
        }
    }

    /* Create new node */
    int new_idx = fs->node_count;
    VFSNode *node = &fs->nodes[new_idx];
    node->inode = fs->next_inode++;
    strncpy(node->name, filename, MAX_FILENAME - 1);
    node->name[MAX_FILENAME - 1] = '\0';
    node->type = type;
    node->size = 0;
    node->permissions = permissions;
    node->created_at = time(NULL);
    node->modified_at = time(NULL);
    node->data = NULL;
    node->parent_inode = parent->inode;
    node->child_count = 0;
    fs->node_count++;

    /* Add to parent's children */
    parent->children[parent->child_count] = new_idx;
    parent->child_count++;

    return new_idx;
}

int vfs_write(VFS *fs, const char *path, const uint8_t *data, uint32_t size, uint32_t offset) {
    int idx = vfs_resolve(fs, path);
    if (idx < 0) {
        return -1;
    }

    VFSNode *node = &fs->nodes[idx];
    if (node->type != FILE_TYPE_REGULAR) {
        return -1;
    }

    uint32_t needed = offset + size;
    if (needed > MAX_FILE_SIZE) {
        return -1;
    }

    /* Allocate or reallocate buffer */
    if (node->data == NULL) {
        node->data = (uint8_t *)malloc(needed);
        if (node->data == NULL) return -1;
        memset(node->data, 0, needed);
    } else if (needed > node->size) {
        /* BUG 5: Memory leak - old data pointer not freed on realloc failure */
        uint8_t *new_data = (uint8_t *)realloc(node->data, needed);
        if (new_data == NULL) return -1;
        /* Zero out the new portion */
        memset(new_data + node->size, 0, needed - node->size);
        node->data = new_data;
    }

    memcpy(node->data + offset, data, size);
    if (needed > node->size) {
        node->size = needed;
    }
    node->modified_at = time(NULL);

    return size;
}

int vfs_read(VFS *fs, const char *path, uint8_t *buffer, uint32_t size, uint32_t offset) {
    int idx = vfs_resolve(fs, path);
    if (idx < 0) {
        return -1;
    }

    VFSNode *node = &fs->nodes[idx];
    if (node->type != FILE_TYPE_REGULAR) {
        return -1;
    }

    if (node->data == NULL || offset >= node->size) {
        return 0;
    }

    uint32_t available = node->size - offset;
    uint32_t to_read = size < available ? size : available;

    memcpy(buffer, node->data + offset, to_read);
    return to_read;
}

int vfs_delete(VFS *fs, const char *path) {
    if (strcmp(path, "/") == 0) {
        return -1; /* Can't delete root */
    }

    int idx = vfs_resolve(fs, path);
    if (idx < 0) {
        return -1;
    }

    VFSNode *node = &fs->nodes[idx];

    /* Don't delete non-empty directories */
    if (node->type == FILE_TYPE_DIRECTORY && node->child_count > 0) {
        return -1;
    }

    /* BUG 6: Memory leak - doesn't free node->data */
    /* free(node->data); // MISSING */

    /* Remove from parent's children */
    for (uint32_t i = 0; i < fs->node_count; i++) {
        VFSNode *parent = &fs->nodes[i];
        if (parent->type != FILE_TYPE_DIRECTORY) continue;
        for (uint32_t j = 0; j < parent->child_count; j++) {
            if (parent->children[j] == (uint32_t)idx) {
                /* Shift children down */
                for (uint32_t k = j; k < parent->child_count - 1; k++) {
                    parent->children[k] = parent->children[k + 1];
                }
                parent->child_count--;
                break;
            }
        }
    }

    /* Mark node as deleted (zero out) */
    memset(node, 0, sizeof(VFSNode));

    return 0;
}

int vfs_list(VFS *fs, const char *path, char names[][MAX_FILENAME], uint32_t *count) {
    int idx = vfs_resolve(fs, path);
    if (idx < 0) {
        return -1;
    }

    VFSNode *node = &fs->nodes[idx];
    if (node->type != FILE_TYPE_DIRECTORY) {
        return -1;
    }

    *count = 0;
    for (uint32_t i = 0; i < node->child_count; i++) {
        uint32_t child_idx = node->children[i];
        strncpy(names[*count], fs->nodes[child_idx].name, MAX_FILENAME - 1);
        names[*count][MAX_FILENAME - 1] = '\0';
        (*count)++;
    }

    return 0;
}

int vfs_stat(VFS *fs, const char *path, VFSNode *info) {
    int idx = vfs_resolve(fs, path);
    if (idx < 0) {
        return -1;
    }

    *info = fs->nodes[idx];
    return 0;
}
