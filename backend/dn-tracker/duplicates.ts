import { createHash } from 'node:crypto';
import type { DNLine } from '../../shared/dn-tracker';
import { assert } from '../core/errors';

export type DuplicateChoice = 'KEEP_ALL' | 'KEEP_FIRST';
export function reviewDuplicates(lines: DNLine[], decisions: Record<string, DuplicateChoice>) {
  const matches = new Map<string, DNLine[]>();
  for (const line of lines) {
    const { row, review, ...content } = line;
    const key = createHash('sha256').update(JSON.stringify(content)).digest('hex');
    const group = matches.get(key);
    if (group) group.push(line); else matches.set(key, [line]);
  }
  const duplicates = [...matches].filter(([, rows]) => rows.length > 1).map(([key, rows]) => ({
    id: createHash('sha256').update(key + ':' + rows.map(r => r.row).join(',')).digest('hex'),
    rows,
  })).map(group => ({ ...group, decision: decisions[group.id] || null }));
  assert(Object.keys(decisions).every(id => duplicates.some(g => g.id === id)), 400, 'Duplicate review changed. Preview the file again');
  const excluded = duplicates.flatMap(g => g.decision === 'KEEP_FIRST' ? g.rows.slice(1) : []);
  const excludedRows = new Set(excluded.map(r => r.row));
  return { duplicates, excluded, included: lines.filter(r => !excludedRows.has(r.row)), unresolved: duplicates.filter(g => !g.decision).length };
}
