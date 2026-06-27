import * as fs from 'fs';
import { BenchmarkInstance } from './types.js';

/**
 * Parse a single CSV line, honoring double-quoted fields that may contain commas.
 * The benchmark file uses the header: ID,分类,平台/语言,案例描述
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { current += '"'; i++; } // escaped quote
        else inQuotes = false;
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields.map(f => f.trim());
}

/**
 * Load benchmark instances from the CSV file.
 * Rows missing a description are skipped.
 */
export function loadBenchmark(csvPath: string): BenchmarkInstance[] {
  const raw = fs.readFileSync(csvPath, 'utf-8');
  const lines = raw.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length <= 1) return [];

  const instances: BenchmarkInstance[] = [];
  // Skip the header row.
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const [id, category, stack, description] = cols;
    if (!description) continue;
    instances.push({
      id: id || String(i),
      category: category || '',
      stack: stack || '',
      description,
    });
  }
  return instances;
}
