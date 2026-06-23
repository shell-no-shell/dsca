/**
 * Custom EventEmitter implementation - L3 test case.
 * Build from scratch without Node's events module.
 */

class EventEmitter {
  constructor() {
    this._events = {};
  }

  on(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push({ fn: listener, once: false });
    return this;
  }

  once(event, listener) {
    if (!this._events[event]) {
      this._events[event] = [];
    }
    this._events[event].push({ fn: listener, once: true });
    return this;
  }

  emit(event, ...args) {
    const listeners = this._events[event];
    if (!listeners || listeners.length === 0) return false;

    // Copy the array before iterating, since we may mutate it
    const toFire = [...listeners];
    for (const listener of toFire) {
      listener.fn.apply(this, args);
    }
    // Remove 'once' listeners after firing
    this._events[event] = listeners.filter(l => !l.once);
    return true;
  }

  off(event, listener) {
    const listeners = this._events[event];
    if (!listeners) return this;
    this._events[event] = listeners.filter(l => l.fn !== listener);
    return this;
  }

  listenerCount(event) {
    return (this._events[event] || []).length;
  }

  // TODO: implement removeAllListeners(event?) - remove all or for specific event
  // TODO: implement eventNames() - return array of event names that have listeners
  // TODO: implement prependListener(event, fn) - add listener to beginning
}

module.exports = { EventEmitter };
