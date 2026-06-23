#ifndef ALLOCATOR_H
#define ALLOCATOR_H

#include <stddef.h>
#include <stdint.h>

#define POOL_SIZE (1024 * 1024)  /* 1MB memory pool */
#define MIN_BLOCK_SIZE 64
#define MAX_ORDER 14  /* log2(POOL_SIZE / MIN_BLOCK_SIZE) */

typedef struct Block {
    uint32_t size;
    uint8_t is_free;
    uint8_t order;
    struct Block *next;
    struct Block *prev;
    struct Block *buddy;
} Block;

typedef struct {
    uint8_t pool[POOL_SIZE];
    Block *free_lists[MAX_ORDER + 1];
    uint32_t total_allocated;
    uint32_t total_freed;
    uint32_t allocation_count;
} BuddyAllocator;

int allocator_init(BuddyAllocator *alloc);
void *allocator_alloc(BuddyAllocator *alloc, uint32_t size);
void allocator_free(BuddyAllocator *alloc, void *ptr);
uint32_t allocator_get_allocated(BuddyAllocator *alloc);
uint32_t allocator_get_free(BuddyAllocator *alloc);
void allocator_dump(BuddyAllocator *alloc);

#endif
