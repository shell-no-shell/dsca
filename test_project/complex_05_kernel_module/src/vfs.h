#ifndef VFS_H
#define VFS_H

#include <stddef.h>
#include <stdint.h>
#include <time.h>

#define MAX_FILENAME 256
#define MAX_PATH 1024
#define MAX_FILES 1024
#define MAX_FILE_SIZE (1024 * 1024)  /* 1MB */
#define BLOCK_SIZE 4096

typedef enum {
    FILE_TYPE_REGULAR,
    FILE_TYPE_DIRECTORY,
    FILE_TYPE_SYMLINK,
} FileType;

typedef struct {
    uint32_t inode;
    char name[MAX_FILENAME];
    FileType type;
    uint32_t size;
    uint32_t permissions;
    time_t created_at;
    time_t modified_at;
    uint8_t *data;
    uint32_t parent_inode;
    uint32_t children[MAX_FILES];  /* For directories */
    uint32_t child_count;
} VFSNode;

typedef struct {
    VFSNode nodes[MAX_FILES];
    uint32_t node_count;
    uint32_t next_inode;
} VFS;

/* Initialize the VFS with a root directory */
int vfs_init(VFS *fs);

/* Create a file or directory */
int vfs_create(VFS *fs, const char *path, FileType type, uint32_t permissions);

/* Read file contents */
int vfs_read(VFS *fs, const char *path, uint8_t *buffer, uint32_t size, uint32_t offset);

/* Write to a file */
int vfs_write(VFS *fs, const char *path, const uint8_t *data, uint32_t size, uint32_t offset);

/* Delete a file or directory */
int vfs_delete(VFS *fs, const char *path);

/* List directory contents */
int vfs_list(VFS *fs, const char *path, char names[][MAX_FILENAME], uint32_t *count);

/* Get file info */
int vfs_stat(VFS *fs, const char *path, VFSNode *info);

/* Resolve path to node index */
int vfs_resolve(VFS *fs, const char *path);

#endif
