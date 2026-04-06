// Shared pipeline utilities used by both the direct pipeline and Inngest functions.

import { callModelZDR, type ModelResult } from './model-client';
import type { ProviderModelConfig } from '@/lib/config/models';

export const SONNET_TIMEOUT_MS = 240_000;
export const OPUS_TIMEOUT_MS = 600_000;

export type { ModelResult };

export async function callModelWithTimeout(
  config: ProviderModelConfig,
  systemPrompt: string,
  messages: Array<{ role: string; content: string }>,
  temperature: number,
  label: string = 'unknown',
  timeoutMs?: number,
): Promise<ModelResult> {
  const timeout = timeoutMs ?? SONNET_TIMEOUT_MS;
  console.log(`[reasonqa] Calling ${config.model} for ${label} (timeout: ${timeout / 1000}s)...`);
  try {
    const result = await Promise.race([
      callModelZDR(config, systemPrompt, messages, temperature),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error(`Model call timed out after ${timeout / 1000}s (${label})`)), timeout),
      ),
    ]);
    console.log(`[reasonqa] ${label} returned: ${result.usage.inputTokens} in / ${result.usage.outputTokens} out`);
    return result;
  } catch (err) {
    console.error(`[reasonqa] ${label} failed:`, err instanceof Error ? err.message : err);
    throw err;
  }
}

export function parseJsonResponse(text: string): unknown {
  // Strip markdown fences
  let cleaned = text
    .replace(/^\s*```(?:json)?\s*\n?/i, '')
    .replace(/\n?\s*```\s*$/i, '')
    .trim();

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  cleaned = cleaned.replace(/,\s*([}\]])/g, '$1');
  cleaned = cleaned.replace(/(?<=:\s*"[^"]*)\n(?=[^"]*")/g, '\\n');
  cleaned = cleaned.replace(/[\x00-\x1f]/g, (ch) => {
    if (ch === '\n' || ch === '\r' || ch === '\t') return ch;
    return '';
  });
  cleaned = cleaned.replace(/\/\/[^\n]*/g, '');

  try { return JSON.parse(cleaned); } catch { /* fall through */ }

  const braceStart = cleaned.indexOf('{');
  const bracketStart = cleaned.indexOf('[');
  let start: number;
  let open: string;
  let close: string;

  if (braceStart === -1 && bracketStart === -1) {
    throw new Error(`No JSON found in LLM response (${cleaned.length} chars)`);
  } else if (bracketStart === -1 || (braceStart !== -1 && braceStart < bracketStart)) {
    start = braceStart; open = '{'; close = '}';
  } else {
    start = bracketStart; open = '['; close = ']';
  }

  let depth = 0, inString = false, escape = false, end = -1;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === open) depth++;
    if (ch === close) { depth--; if (depth === 0) { end = i; break; } }
  }

  if (end === -1) {
    console.warn('[reasonqa] JSON truncated — attempting repair');
    return JSON.parse(repairTruncatedJson(cleaned.slice(start)));
  }

  let extracted = cleaned.slice(start, end + 1);
  extracted = extracted.replace(/,\s*([}\]])/g, '$1');
  return JSON.parse(extracted);
}

function repairTruncatedJson(partial: string): string {
  let result = partial;
  const stack: string[] = [];
  let inString = false, escape = false;

  for (let i = 0; i < result.length; i++) {
    const ch = result[i];
    if (escape) { escape = false; continue; }
    if (ch === '\\' && inString) { escape = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }

  if (inString) result += '"';
  result = result.replace(/,\s*"[^"]*$/, '');
  result = result.replace(/,\s*$/, '');
  result = result.replace(/:\s*$/, ': null');
  while (stack.length > 0) result += stack.pop();
  result = result.replace(/,\s*([}\]])/g, '$1');
  return result;
}
