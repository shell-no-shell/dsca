const { describe, it } = require("node:test");
const assert = require("node:assert");
const { EventEmitter } = require("./event-emitter");

describe("EventEmitter", () => {
  it("should register and emit events", () => {
    const emitter = new EventEmitter();
    let called = false;
    emitter.on("test", () => { called = true; });
    emitter.emit("test");
    assert.strictEqual(called, true);
  });

  it("should pass arguments to listeners", () => {
    const emitter = new EventEmitter();
    let result;
    emitter.on("data", (a, b) => { result = a + b; });
    emitter.emit("data", 3, 4);
    assert.strictEqual(result, 7);
  });

  // WILL FAIL: once listeners are not removed after firing
  it("should fire once listeners only once", () => {
    const emitter = new EventEmitter();
    let count = 0;
    emitter.once("ping", () => { count++; });
    emitter.emit("ping");
    emitter.emit("ping");
    assert.strictEqual(count, 1); // BUG: count will be 2
  });

  // WILL FAIL: off compares wrong property
  it("should remove listener with off", () => {
    const emitter = new EventEmitter();
    let count = 0;
    const handler = () => { count++; };
    emitter.on("tick", handler);
    emitter.emit("tick");
    emitter.off("tick", handler);
    emitter.emit("tick");
    assert.strictEqual(count, 1); // BUG: count will be 2
  });

  it("should return false for events with no listeners", () => {
    const emitter = new EventEmitter();
    assert.strictEqual(emitter.emit("nothing"), false);
  });

  it("should track listener count", () => {
    const emitter = new EventEmitter();
    emitter.on("a", () => {});
    emitter.on("a", () => {});
    assert.strictEqual(emitter.listenerCount("a"), 2);
    assert.strictEqual(emitter.listenerCount("b"), 0);
  });
});
