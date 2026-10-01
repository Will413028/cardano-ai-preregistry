import { canonicalize as jcs } from 'json-canonicalize';

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export interface Manifest {
  schema_version: 1;
  title: string;
  reveal_deadline: string;
  datasets: { id: string; role: 'evaluation' | 'retrieval' | 'training'; version: string; sha256: string }[];
  experiments: {
    id: string;
    model: { id: string; version: string };
    settings: Record<string, Json>;
    metrics: { id: string; method: string }[];
    planned_runs: number;
  }[];
}

function validate_json(value: unknown): asserts value is Json {
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || (Number.isInteger(value) && !Number.isSafeInteger(value))) {
      throw new Error('Use decimal strings for integers outside the JSON safe-number range.');
    }
    return;
  }
  if (typeof value === 'string') {
    if (!value.isWellFormed()) throw new Error('Unpaired Unicode surrogate is not valid JCS input.');
    return;
  }
  if (Array.isArray(value)) { value.forEach(validate_json); return; }
  if (typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    for (const [key, item] of Object.entries(value)) { validate_json(key); validate_json(item); }
    return;
  }
  throw new Error('Expected a JSON value.');
}

export function canonicalize(value: unknown): string {
  validate_json(value);
  return jcs(value);
}

// Parse before canonicalizing so duplicate keys cannot silently replace planned settings.
export function parse_json(text: string): Json {
  let i = 0;
  const space = () => { while (/\s/.test(text[i] ?? '') && i < text.length) i++; };
  const string = (): string => {
    const start = i++;
    while (i < text.length) {
      const c = text[i++];
      if (c === '\\') i++;
      else if (c === '"') return JSON.parse(text.slice(start, i)) as string;
    }
    throw new Error('Unterminated JSON string.');
  };
  const value = (): Json => {
    space();
    if (text[i] === '"') return string();
    if (text[i] === '{') {
      i++; space();
      const entries: [string, Json][] = [];
      const keys = new Set<string>();
      if (text[i] !== '}') {
        while (true) {
          space(); if (text[i] !== '"') throw new Error('Expected JSON object key.');
          const key = string();
          if (keys.has(key)) throw new Error('Duplicate JSON key: ' + key);
          keys.add(key); space();
          if (text[i++] !== ':') throw new Error('Expected colon.');
          entries.push([key, value()]); space();
          if (text[i] !== ',') break;
          i++;
        }
      }
      if (text[i++] !== '}') throw new Error('Expected closing brace.');
      return Object.fromEntries(entries);
    }
    if (text[i] === '[') {
      i++; space(); const items: Json[] = [];
      if (text[i] !== ']') { while (true) { items.push(value()); space(); if (text[i] !== ',') break; i++; } }
      if (text[i++] !== ']') throw new Error('Expected closing bracket.');
      return items;
    }
    const token = text.slice(i).match(/^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/)?.[0];
    if (!token) throw new Error('Invalid JSON value.');
    i += token.length;
    return JSON.parse(token) as Json;
  };
  // JSON.parse enforces the exact JSON whitespace and syntax grammar as well.
  JSON.parse(text);
  const parsed = value(); space();
  if (i !== text.length) throw new Error('Unexpected trailing JSON input.');
  validate_json(parsed);
  return parsed;
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Expected an object.');
  return value as Record<string, unknown>;
}
function exact(value: Record<string, unknown>, keys: string[]) {
  if (Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw new Error('Unexpected or missing schema fields.');
}
function nonempty(value: unknown) { if (typeof value !== 'string' || !value.trim()) throw new Error('Expected a nonempty string.'); }
function unique(items: Record<string, unknown>[]) {
  if (new Set(items.map(x => x.id)).size !== items.length) throw new Error('IDs must be unique within each list.');
}

export function validate_manifest(input: unknown): Manifest {
  validate_json(input);
  const m = object(input);
  exact(m, ['schema_version', 'title', 'reveal_deadline', 'datasets', 'experiments']);
  if (m.schema_version !== 1) throw new Error('Unsupported manifest schema version.');
  nonempty(m.title);
  if (typeof m.reveal_deadline !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(m.reveal_deadline) ||
      !Number.isFinite(Date.parse(m.reveal_deadline)) || new Date(m.reveal_deadline).toISOString().replace('.000Z', 'Z') !== m.reveal_deadline) {
    throw new Error('reveal_deadline must be a real UTC timestamp, YYYY-MM-DDTHH:mm:ssZ.');
  }
  if (!Array.isArray(m.datasets) || !Array.isArray(m.experiments) || !m.experiments.length) throw new Error('Expected datasets and at least one experiment.');
  const datasets = m.datasets.map(item => {
    const d = object(item); exact(d, ['id', 'role', 'version', 'sha256']); nonempty(d.id); nonempty(d.version);
    if (!['evaluation', 'retrieval', 'training'].includes(String(d.role))) throw new Error('Unknown dataset role.');
    if (typeof d.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(d.sha256)) throw new Error('Dataset sha256 must be 64 lowercase hex characters.');
    return d;
  });
  const experiments = m.experiments.map(item => {
    const e = object(item); exact(e, ['id', 'model', 'settings', 'metrics', 'planned_runs']); nonempty(e.id);
    const model = object(e.model); exact(model, ['id', 'version']); nonempty(model.id); nonempty(model.version);
    object(e.settings);
    if (!Number.isSafeInteger(e.planned_runs) || Number(e.planned_runs) < 1) throw new Error('planned_runs must be a positive safe integer.');
    if (!Array.isArray(e.metrics) || !e.metrics.length) throw new Error('Each experiment needs at least one metric.');
    const metrics = e.metrics.map(item => { const x = object(item); exact(x, ['id', 'method']); nonempty(x.id); nonempty(x.method); return x; });
    unique(metrics); return e;
  });
  unique(datasets); unique(experiments);
  return input as unknown as Manifest;
}

export const sample_manifest: Manifest = {
  schema_version: 1,
  title: 'Example: retrieval baseline',
  reveal_deadline: '2030-01-01T00:00:00Z',
  datasets: [{ id: 'example-evaluation', role: 'evaluation', version: 'v1', sha256: 'a'.repeat(64) }],
  experiments: [{
    id: 'baseline', model: { id: 'example-model', version: 'v1' },
    settings: { temperature: 0.2, top_k: 5 },
    metrics: [{ id: 'accuracy', method: 'Exact match, fraction of correct answers.' }], planned_runs: 3,
  }],
};
