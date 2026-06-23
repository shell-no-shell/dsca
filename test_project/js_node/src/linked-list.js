/**
 * Linked List implementation - L2 test case.
 * Contains bugs and missing methods.
 */

class Node {
  constructor(value) {
    this.value = value;
    this.next = null;
  }
}

class LinkedList {
  constructor() {
    this.head = null;
    this.size = 0;
  }

  // Add to end
  append(value) {
    const node = new Node(value);
    if (!this.head) {
      this.head = node;
    } else {
      let current = this.head;
      while (current.next) {
        current = current.next;
      }
      current.next = node;
    }
    this.size++;
  }

  // Add to beginning
  prepend(value) {
    const node = new Node(value);
    node.next = this.head;
    this.head = node;
    this.size++;
  }

  remove(value) {
    if (!this.head) return false;
    if (this.head.value === value) {
      this.head = this.head.next;
      this.size--;
      return true;
    }
    let current = this.head;
    while (current.next) {
      if (current.next.value === value) {
        current.next = current.next.next;
        this.size--;
        return true;
      }
      current = current.next;
    }
    return false;
  }

  find(value) {
    let current = this.head;
    let index = 0;
    while (current) {
      if (current.value === value) return index;
      current = current.next;
      index++;
    }
    return null;
  }

  toArray() {
    const result = [];
    let current = this.head;
    while (current) {
      result.push(current.value);
      current = current.next;
    }
    return result;
  }

  insertAt(index, value) {
    if (index < 0 || index > this.size) return false;
    if (index === 0) {
      this.prepend(value);
      return true;
    }
    const node = new Node(value);
    let current = this.head;
    for (let i = 0; i < index - 1; i++) {
      current = current.next;
    }
    node.next = current.next;
    current.next = node;
    this.size++;
    return true;
  }

  removeAt(index) {
    if (index < 0 || index >= this.size) return undefined;
    if (index === 0) {
      const value = this.head.value;
      this.head = this.head.next;
      this.size--;
      return value;
    }
    let current = this.head;
    for (let i = 0; i < index - 1; i++) {
      current = current.next;
    }
    const value = current.next.value;
    current.next = current.next.next;
    this.size--;
    return value;
  }

  reverse() {
    let prev = null;
    let current = this.head;
    while (current) {
      const next = current.next;
      current.next = prev;
      prev = current;
      current = next;
    }
    this.head = prev;
  }

  has(value) {
    return this.find(value) !== null;
  }

  toString() {
    const parts = [];
    let current = this.head;
    while (current) {
      parts.push(current.value);
      current = current.next;
    }
    parts.push("null");
    return parts.join(" -> ");
  }
}

module.exports = { LinkedList, Node };
