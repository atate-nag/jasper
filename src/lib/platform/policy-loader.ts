import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import yaml from 'js-yaml';
import type { Policy } from '@/lib/platform/types';

let _policies: Policy[] | null = null;

export function loadPolicies(policyDir?: string): Policy[] {
  if (_policies) return _policies;

  const dir = policyDir ?? join(process.cwd(), 'docs', 'policies');

  try {
    const files = readdirSync(dir).filter(f => f.endsWith('.yaml') || f.endsWith('.yml'));
    _policies = files.map(f => {
      const content = readFileSync(join(dir, f), 'utf-8');
      return yaml.load(content) as Policy;
    });
    return _policies;
  } catch {
    console.warn('[policy-loader] Could not load policies from disk, returning empty');
    return [];
  }
}

export function reloadPolicies(policyDir?: string): Policy[] {
  _policies = null;
  return loadPolicies(policyDir);
}
