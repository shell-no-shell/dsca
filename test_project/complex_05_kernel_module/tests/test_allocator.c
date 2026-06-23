#include <stdio.h>
#include <string.h>
#include <assert.h>
#include "../src/allocator.h"

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) do { \
    printf("  TEST: %s ... ", #name); \
    tests_run++; \
    name(); \
    tests_passed++; \
    printf("PASS\n"); \
} while(0)

#define ASSERT_TRUE(x) do { \
    if (!(x)) { \
        printf("FAIL\n    %s:%d: assertion failed\n", __FILE__, __LINE__); \
        return; \
    } \
} while(0)

#define ASSERT_EQ(a, b) do { \
    if ((a) != (b)) { \
        printf("FAIL\n    %s:%d: %u != %u\n", __FILE__, __LINE__, (unsigned)(a), (unsigned)(b)); \
        return; \
    } \
} while(0)

static BuddyAllocator alloc;

static void setup(void) {
    allocator_init(&alloc);
}

void test_init(void) {
    setup();
    ASSERT_EQ(allocator_get_allocated(&alloc), 0);
    ASSERT_EQ(allocator_get_free(&alloc), POOL_SIZE);
}

void test_basic_alloc(void) {
    setup();
    void *p = allocator_alloc(&alloc, 100);
    ASSERT_TRUE(p != NULL);
    ASSERT_TRUE(allocator_get_allocated(&alloc) > 0);
}

void test_alloc_and_free(void) {
    setup();
    void *p = allocator_alloc(&alloc, 100);
    ASSERT_TRUE(p != NULL);

    uint32_t allocated = allocator_get_allocated(&alloc);
    ASSERT_TRUE(allocated > 0);

    allocator_free(&alloc, p);
    ASSERT_EQ(allocator_get_allocated(&alloc), 0);
}

void test_multiple_allocs(void) {
    setup();
    void *p1 = allocator_alloc(&alloc, 100);
    void *p2 = allocator_alloc(&alloc, 200);
    void *p3 = allocator_alloc(&alloc, 300);

    ASSERT_TRUE(p1 != NULL);
    ASSERT_TRUE(p2 != NULL);
    ASSERT_TRUE(p3 != NULL);

    /* All pointers should be different */
    ASSERT_TRUE(p1 != p2);
    ASSERT_TRUE(p2 != p3);
    ASSERT_TRUE(p1 != p3);
}

void test_alloc_zero_returns_null(void) {
    setup();
    void *p = allocator_alloc(&alloc, 0);
    ASSERT_TRUE(p == NULL);
}

void test_alloc_too_large(void) {
    setup();
    void *p = allocator_alloc(&alloc, POOL_SIZE + 1);
    ASSERT_TRUE(p == NULL);
}

void test_free_null(void) {
    setup();
    /* Should not crash */
    allocator_free(&alloc, NULL);
}

void test_write_to_allocated(void) {
    setup();
    char *p = (char *)allocator_alloc(&alloc, 100);
    ASSERT_TRUE(p != NULL);

    /* Should be able to write without issues */
    strcpy(p, "Hello, allocator!");
    ASSERT_TRUE(strcmp(p, "Hello, allocator!") == 0);

    allocator_free(&alloc, p);
}

void test_buddy_coalescing(void) {
    setup();
    /* Allocate two blocks that should be buddies */
    void *p1 = allocator_alloc(&alloc, 100);
    void *p2 = allocator_alloc(&alloc, 100);

    uint32_t free_before = allocator_get_free(&alloc);

    /* Free both - they should coalesce back */
    allocator_free(&alloc, p1);
    allocator_free(&alloc, p2);

    uint32_t free_after = allocator_get_free(&alloc);

    /* BUG TEST: After freeing both buddies, free space should equal POOL_SIZE */
    /* But coalescing is broken, so free space will be fragmented */
    ASSERT_EQ(free_after, POOL_SIZE);
}

void test_fragmentation_recovery(void) {
    setup();
    /* Allocate many small blocks */
    void *ptrs[16];
    for (int i = 0; i < 16; i++) {
        ptrs[i] = allocator_alloc(&alloc, 100);
        ASSERT_TRUE(ptrs[i] != NULL);
    }

    /* Free all blocks */
    for (int i = 0; i < 16; i++) {
        allocator_free(&alloc, ptrs[i]);
    }

    /* BUG TEST: After freeing all, should be able to allocate a large block */
    /* But without proper recursive coalescing, memory stays fragmented */
    void *large = allocator_alloc(&alloc, POOL_SIZE / 2);
    ASSERT_TRUE(large != NULL);

    allocator_free(&alloc, large);
}

void test_alloc_exact_min_size(void) {
    setup();
    void *p = allocator_alloc(&alloc, 1);
    ASSERT_TRUE(p != NULL);
    allocator_free(&alloc, p);
}

int main(void) {
    printf("=== Allocator Tests ===\n");

    TEST(test_init);
    TEST(test_basic_alloc);
    TEST(test_alloc_and_free);
    TEST(test_multiple_allocs);
    TEST(test_alloc_zero_returns_null);
    TEST(test_alloc_too_large);
    TEST(test_free_null);
    TEST(test_write_to_allocated);
    TEST(test_buddy_coalescing);
    TEST(test_fragmentation_recovery);
    TEST(test_alloc_exact_min_size);

    printf("\n%d/%d tests passed\n", tests_passed, tests_run);
    return tests_passed == tests_run ? 0 : 1;
}
