CC = gcc
CFLAGS = -Wall -Wextra -std=c11 -g
# BUG: Missing -Werror and sanitizer flags
# Should have: CFLAGS += -Werror -fsanitize=address -fsanitize=undefined

SRC_DIR = src
TEST_DIR = tests
BUILD_DIR = build

SRCS = $(SRC_DIR)/vfs.c $(SRC_DIR)/allocator.c

.PHONY: all clean test test_vfs test_allocator

all: $(BUILD_DIR)/test_vfs $(BUILD_DIR)/test_allocator

$(BUILD_DIR):
	mkdir -p $(BUILD_DIR)

$(BUILD_DIR)/test_vfs: $(TEST_DIR)/test_vfs.c $(SRC_DIR)/vfs.c $(SRC_DIR)/vfs.h | $(BUILD_DIR)
	$(CC) $(CFLAGS) -o $@ $(TEST_DIR)/test_vfs.c $(SRC_DIR)/vfs.c

$(BUILD_DIR)/test_allocator: $(TEST_DIR)/test_allocator.c $(SRC_DIR)/allocator.c $(SRC_DIR)/allocator.h | $(BUILD_DIR)
	$(CC) $(CFLAGS) -o $@ $(TEST_DIR)/test_allocator.c $(SRC_DIR)/allocator.c

test: test_vfs test_allocator

test_vfs: $(BUILD_DIR)/test_vfs
	./$(BUILD_DIR)/test_vfs

test_allocator: $(BUILD_DIR)/test_allocator
	./$(BUILD_DIR)/test_allocator

clean:
	rm -rf $(BUILD_DIR)
