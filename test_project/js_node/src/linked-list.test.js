const { describe, it } = require("node:test");
const assert = require("node:assert");
const { LinkedList } = require("./linked-list");

describe("LinkedList", () => {
  it("should append values", () => {
    const list = new LinkedList();
    list.append(1);
    list.append(2);
    list.append(3);
    assert.deepStrictEqual(list.toArray(), [1, 2, 3]);
    assert.strictEqual(list.size, 3);
  });

  it("should prepend values", () => {
    const list = new LinkedList();
    list.prepend(1);
    list.prepend(2);
    assert.deepStrictEqual(list.toArray(), [2, 1]);
  });

  // WILL FAIL: remove doesn't update size
  it("should update size after remove", () => {
    const list = new LinkedList();
    list.append(1);
    list.append(2);
    list.append(3);
    list.remove(2);
    assert.strictEqual(list.size, 2);  // BUG: size is still 3
  });

  // WILL FAIL: find returns -1 instead of null for not found
  it("should return null when value not found", () => {
    const list = new LinkedList();
    list.append(1);
    assert.strictEqual(list.find(99), null);
  });
});
