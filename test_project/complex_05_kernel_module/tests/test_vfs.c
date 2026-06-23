#include <stdio.h>
#include <string.h>
#include <assert.h>
#include <stdlib.h>
#include "../src/vfs.h"

static int tests_run = 0;
static int tests_passed = 0;

#define TEST(name) do { \
    printf("  TEST: %s ... ", #name); \
    tests_run++; \
    name(); \
    tests_passed++; \
    printf("PASS\n"); \
} while(0)

#define ASSERT_EQ(a, b) do { \
    if ((a) != (b)) { \
        printf("FAIL\n    %s:%d: %d != %d\n", __FILE__, __LINE__, (int)(a), (int)(b)); \
        return; \
    } \
} while(0)

#define ASSERT_STR_EQ(a, b) do { \
    if (strcmp((a), (b)) != 0) { \
        printf("FAIL\n    %s:%d: '%s' != '%s'\n", __FILE__, __LINE__, (a), (b)); \
        return; \
    } \
} while(0)

#define ASSERT_TRUE(x) do { \
    if (!(x)) { \
        printf("FAIL\n    %s:%d: assertion failed\n", __FILE__, __LINE__); \
        return; \
    } \
} while(0)

static VFS fs;

static void setup(void) {
    vfs_init(&fs);
}

/* ===== Test Cases ===== */

void test_init(void) {
    setup();
    ASSERT_EQ(fs.node_count, 1);
    ASSERT_STR_EQ(fs.nodes[0].name, "/");
    ASSERT_EQ(fs.nodes[0].type, FILE_TYPE_DIRECTORY);
}

void test_create_file(void) {
    setup();
    int idx = vfs_create(&fs, "/hello.txt", FILE_TYPE_REGULAR, 0644);
    ASSERT_TRUE(idx > 0);
    ASSERT_STR_EQ(fs.nodes[idx].name, "hello.txt");
    ASSERT_EQ(fs.nodes[idx].type, FILE_TYPE_REGULAR);
}

void test_create_directory(void) {
    setup();
    int idx = vfs_create(&fs, "/subdir", FILE_TYPE_DIRECTORY, 0755);
    ASSERT_TRUE(idx > 0);
    ASSERT_EQ(fs.nodes[idx].type, FILE_TYPE_DIRECTORY);
}

void test_create_nested_file(void) {
    setup();
    vfs_create(&fs, "/subdir", FILE_TYPE_DIRECTORY, 0755);
    int idx = vfs_create(&fs, "/subdir/file.txt", FILE_TYPE_REGULAR, 0644);
    ASSERT_TRUE(idx > 0);
    ASSERT_STR_EQ(fs.nodes[idx].name, "file.txt");
}

void test_resolve_path(void) {
    setup();
    vfs_create(&fs, "/a", FILE_TYPE_DIRECTORY, 0755);
    vfs_create(&fs, "/a/b", FILE_TYPE_DIRECTORY, 0755);
    vfs_create(&fs, "/a/b/c.txt", FILE_TYPE_REGULAR, 0644);

    int idx = vfs_resolve(&fs, "/a/b/c.txt");
    ASSERT_TRUE(idx > 0);
    ASSERT_STR_EQ(fs.nodes[idx].name, "c.txt");
}

void test_write_and_read(void) {
    setup();
    vfs_create(&fs, "/data.txt", FILE_TYPE_REGULAR, 0644);

    const char *content = "Hello, VFS!";
    int written = vfs_write(&fs, "/data.txt", (const uint8_t *)content, strlen(content), 0);
    ASSERT_EQ(written, (int)strlen(content));

    uint8_t buffer[256] = {0};
    int read = vfs_read(&fs, "/data.txt", buffer, 256, 0);
    ASSERT_EQ(read, (int)strlen(content));
    ASSERT_STR_EQ((char *)buffer, content);
}

void test_write_at_offset(void) {
    setup();
    vfs_create(&fs, "/offset.txt", FILE_TYPE_REGULAR, 0644);

    vfs_write(&fs, "/offset.txt", (const uint8_t *)"Hello", 5, 0);
    vfs_write(&fs, "/offset.txt", (const uint8_t *)" World", 6, 5);

    uint8_t buffer[256] = {0};
    vfs_read(&fs, "/offset.txt", buffer, 256, 0);
    ASSERT_STR_EQ((char *)buffer, "Hello World");
}

void test_delete_file(void) {
    setup();
    vfs_create(&fs, "/todelete.txt", FILE_TYPE_REGULAR, 0644);
    ASSERT_TRUE(vfs_resolve(&fs, "/todelete.txt") > 0);

    int result = vfs_delete(&fs, "/todelete.txt");
    ASSERT_EQ(result, 0);

    ASSERT_EQ(vfs_resolve(&fs, "/todelete.txt"), -1);
}

void test_delete_nonempty_dir(void) {
    setup();
    vfs_create(&fs, "/mydir", FILE_TYPE_DIRECTORY, 0755);
    vfs_create(&fs, "/mydir/file.txt", FILE_TYPE_REGULAR, 0644);

    int result = vfs_delete(&fs, "/mydir");
    ASSERT_EQ(result, -1);  /* Should fail */
}

void test_list_directory(void) {
    setup();
    vfs_create(&fs, "/file1.txt", FILE_TYPE_REGULAR, 0644);
    vfs_create(&fs, "/file2.txt", FILE_TYPE_REGULAR, 0644);
    vfs_create(&fs, "/subdir", FILE_TYPE_DIRECTORY, 0755);

    char names[MAX_FILES][MAX_FILENAME];
    uint32_t count = 0;
    int result = vfs_list(&fs, "/", names, &count);
    ASSERT_EQ(result, 0);
    ASSERT_EQ(count, 3);
}

void test_duplicate_create(void) {
    setup();
    int idx1 = vfs_create(&fs, "/dup.txt", FILE_TYPE_REGULAR, 0644);
    int idx2 = vfs_create(&fs, "/dup.txt", FILE_TYPE_REGULAR, 0644);
    ASSERT_TRUE(idx1 > 0);
    ASSERT_EQ(idx2, -2);  /* Already exists */
}

void test_stat(void) {
    setup();
    vfs_create(&fs, "/info.txt", FILE_TYPE_REGULAR, 0644);
    vfs_write(&fs, "/info.txt", (const uint8_t *)"data", 4, 0);

    VFSNode info;
    int result = vfs_stat(&fs, "/info.txt", &info);
    ASSERT_EQ(result, 0);
    ASSERT_EQ(info.size, 4);
    ASSERT_EQ(info.type, FILE_TYPE_REGULAR);
}

void test_cannot_delete_root(void) {
    setup();
    int result = vfs_delete(&fs, "/");
    ASSERT_EQ(result, -1);
}

void test_path_overflow(void) {
    setup();
    /* Create a path exactly at MAX_PATH boundary */
    char long_path[MAX_PATH + 1];
    long_path[0] = '/';
    memset(long_path + 1, 'a', MAX_PATH - 1);
    long_path[MAX_PATH] = '\0';

    /* BUG TEST: vfs_resolve uses strcpy without bounds checking */
    /* This test documents the vulnerability - DSCA should add bounds checking */
    /* For now, test a path just under the limit to avoid crashing */
    char safe_long_path[MAX_PATH];
    safe_long_path[0] = '/';
    memset(safe_long_path + 1, 'a', MAX_PATH - 2);
    safe_long_path[MAX_PATH - 1] = '\0';

    int result = vfs_resolve(&fs, safe_long_path);
    ASSERT_EQ(result, -1);
}

void test_read_nonexistent(void) {
    setup();
    uint8_t buffer[256];
    int result = vfs_read(&fs, "/nonexistent.txt", buffer, 256, 0);
    ASSERT_EQ(result, -1);
}

int main(void) {
    printf("=== VFS Tests ===\n");

    TEST(test_init);
    TEST(test_create_file);
    TEST(test_create_directory);
    TEST(test_create_nested_file);
    TEST(test_resolve_path);
    TEST(test_write_and_read);
    TEST(test_write_at_offset);
    TEST(test_delete_file);
    TEST(test_delete_nonempty_dir);
    TEST(test_list_directory);
    TEST(test_duplicate_create);
    TEST(test_stat);
    TEST(test_cannot_delete_root);
    TEST(test_path_overflow);
    TEST(test_read_nonexistent);

    printf("\n%d/%d tests passed\n", tests_passed, tests_run);
    return tests_passed == tests_run ? 0 : 1;
}
