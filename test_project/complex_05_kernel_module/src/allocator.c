#include "allocator.h"
#include <string.h>
#include <stdio.h>

static uint32_t next_power_of_two(uint32_t n) {
    n--;
    n |= n >> 1;
    n |= n >> 2;
    n |= n >> 4;
    n |= n >> 8;
    n |= n >> 16;
    n++;
    return n;
}

static uint8_t get_order(uint32_t size) {
    uint32_t adjusted = next_power_of_two(size + sizeof(Block));
    if (adjusted < MIN_BLOCK_SIZE) adjusted = MIN_BLOCK_SIZE;

    uint8_t order = 0;
    uint32_t s = MIN_BLOCK_SIZE;
    while (s < adjusted) {
        s <<= 1;
        order++;
    }
    return order;
}

static uint32_t order_to_size(uint8_t order) {
    return MIN_BLOCK_SIZE << order;
}

int allocator_init(BuddyAllocator *alloc) {
    memset(alloc, 0, sizeof(BuddyAllocator));

    /* Initialize the entire pool as one free block at max order */
    Block *initial = (Block *)alloc->pool;
    initial->size = POOL_SIZE;
    initial->is_free = 1;
    initial->order = MAX_ORDER;
    initial->next = NULL;
    initial->prev = NULL;
    initial->buddy = NULL;

    alloc->free_lists[MAX_ORDER] = initial;

    return 0;
}

void *allocator_alloc(BuddyAllocator *alloc, uint32_t size) {
    if (size == 0 || size > POOL_SIZE - sizeof(Block)) {
        return NULL;
    }

    uint8_t order = get_order(size);
    if (order > MAX_ORDER) {
        return NULL;
    }

    /* Find a free block of sufficient order */
    uint8_t current_order = order;
    while (current_order <= MAX_ORDER && alloc->free_lists[current_order] == NULL) {
        current_order++;
    }

    if (current_order > MAX_ORDER) {
        return NULL; /* Out of memory */
    }

    /* Remove block from free list */
    Block *block = alloc->free_lists[current_order];
    alloc->free_lists[current_order] = block->next;
    if (block->next) {
        block->next->prev = NULL;
    }

    /* Split down to required order */
    while (current_order > order) {
        current_order--;
        uint32_t half_size = order_to_size(current_order);

        Block *buddy = (Block *)((uint8_t *)block + half_size);
        buddy->size = half_size;
        buddy->is_free = 1;
        buddy->order = current_order;
        buddy->next = alloc->free_lists[current_order];
        buddy->prev = NULL;
        buddy->buddy = block;

        if (alloc->free_lists[current_order]) {
            alloc->free_lists[current_order]->prev = buddy;
        }
        alloc->free_lists[current_order] = buddy;

        block->size = half_size;
        block->order = current_order;
    }

    block->is_free = 0;
    alloc->total_allocated += order_to_size(order);
    alloc->allocation_count++;

    /* Return pointer after Block header */
    return (void *)((uint8_t *)block + sizeof(Block));
}

void allocator_free(BuddyAllocator *alloc, void *ptr) {
    if (ptr == NULL) return;

    Block *block = (Block *)((uint8_t *)ptr - sizeof(Block));

    /* Validate the block is within our pool */
    if ((uint8_t *)block < alloc->pool ||
        (uint8_t *)block >= alloc->pool + POOL_SIZE) {
        return; /* Invalid pointer */
    }

    block->is_free = 1;
    alloc->total_freed += order_to_size(block->order);

    /* BUG: Buddy coalescing is broken - doesn't properly merge buddies */
    /* Should try to merge with buddy and continue up the tree */
    /* Currently just adds back to free list without coalescing */

    /* Try to coalesce with buddy */
    while (block->order < MAX_ORDER) {
        uint32_t block_size = order_to_size(block->order);
        uint32_t offset = (uint8_t *)block - alloc->pool;
        uint32_t buddy_offset = offset ^ block_size;

        if (buddy_offset >= POOL_SIZE) break;

        Block *buddy = (Block *)(alloc->pool + buddy_offset);

        /* BUG: Doesn't check if buddy is the CORRECT order */
        if (!buddy->is_free) {
            break;
        }

        /* Remove buddy from its free list */
        if (buddy->prev) {
            buddy->prev->next = buddy->next;
        } else {
            alloc->free_lists[buddy->order] = buddy->next;
        }
        if (buddy->next) {
            buddy->next->prev = buddy->prev;
        }

        /* Merge: use the lower-addressed block */
        if (buddy < block) {
            block = buddy;
        }
        block->order++;
        block->size = order_to_size(block->order);

        /* BUG: Doesn't continue trying to coalesce at the next level */
        break;  /* BUG: Should continue the loop, not break */
    }

    /* Add to free list */
    block->next = alloc->free_lists[block->order];
    block->prev = NULL;
    if (alloc->free_lists[block->order]) {
        alloc->free_lists[block->order]->prev = block;
    }
    alloc->free_lists[block->order] = block;
}

uint32_t allocator_get_allocated(BuddyAllocator *alloc) {
    return alloc->total_allocated - alloc->total_freed;
}

uint32_t allocator_get_free(BuddyAllocator *alloc) {
    uint32_t total = 0;
    for (int i = 0; i <= MAX_ORDER; i++) {
        Block *b = alloc->free_lists[i];
        while (b) {
            total += order_to_size(i);
            b = b->next;
        }
    }
    return total;
}

void allocator_dump(BuddyAllocator *alloc) {
    printf("=== Allocator State ===\n");
    printf("Allocated: %u bytes\n", allocator_get_allocated(alloc));
    printf("Free: %u bytes\n", allocator_get_free(alloc));
    printf("Allocations: %u\n", alloc->allocation_count);
    for (int i = 0; i <= MAX_ORDER; i++) {
        int count = 0;
        Block *b = alloc->free_lists[i];
        while (b) {
            count++;
            b = b->next;
        }
        if (count > 0) {
            printf("  Order %d (%u bytes): %d free blocks\n",
                   i, order_to_size(i), count);
        }
    }
}
