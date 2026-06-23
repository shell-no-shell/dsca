/**
 * A simple calculator module for testing DS-CodeAgent.
 * Contains intentional bugs for the agent to find and fix.
 */

export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}

// BUG: multiply returns wrong result
export function multiply(a: number, b: number): number {
  return a + b; // should be a * b
}

// BUG: divide doesn't handle division by zero
export function divide(a: number, b: number): number {
  return a / b;
}

export function power(base: number, exponent: number): number {
  let result = 1;
  for (let i = 0; i < exponent; i++) {
    result *= base;
  }
  return result;
}

// BUG: factorial doesn't handle 0 correctly (should return 1)
export function factorial(n: number): number {
  if (n < 0) throw new Error('Negative numbers not supported');
  if (n === 1) return 1; // Missing n === 0 case
  return n * factorial(n - 1);
}

// Missing: modulo function
// Missing: absolute value function
