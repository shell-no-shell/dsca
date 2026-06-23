/**
 * String utility functions for testing DS-CodeAgent.
 */

export function capitalize(str: string): string {
  if (!str) return str;
  return str.charAt(0).toUpperCase() + str.slice(1);
}

export function reverse(str: string): string {
  return str.split('').reverse().join('');
}

export function isPalindrome(str: string): boolean {
  const cleaned = str.toLowerCase().replace(/[^a-z0-9]/g, '');
  return cleaned === reverse(cleaned);
}

// TODO: Implement these functions
// - truncate(str, maxLength, suffix?)
// - slugify(str)
// - camelToSnake(str)
// - snakeToCamel(str)
