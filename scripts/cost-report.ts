// Token usage and cost report.
// Usage: npx tsx scripts/cost-report.ts [days]
// Default: last 7 days

import { config } from 'dotenv';
config({ path: '.env.local' });

import { createClient } from '@supabase/supabase-js';

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
);

const days = parseInt(process.argv[2] || '7');

async function main(): Promise<void> {
  const since = new Date();
  since.setDate(since.getDate() - days);

  const { data: usage } = await sb.from('token_usage')
    .select('*')
    .gte('created_at', since.toISOString())
    .order('created_at', { ascending: true });

  if (!usage || usage.length === 0) {
    console.log('No usage data found.');
    return;
  }

  // Get user names
  const { data: profiles } = await sb.from('user_profiles').select('user_id, identity');
  const { data: { users } } = await sb.auth.admin.listUsers();
  const nameMap: Record<string, string> = {};
  for (const u of users) nameMap[u.id] = u.email || u.id.slice(0, 8);
  for (const p of (profiles || [])) {
    const name = (p.identity as Record<string, unknown>)?.name as string;
    if (name) nameMap[p.user_id] = name;
  }

  // Totals
  const totalCost = usage.reduce((s, u) => s + (u.cost_usd || 0), 0);
  const totalInput = usage.reduce((s, u) => s + (u.input_tokens || 0), 0);
  const totalOutput = usage.reduce((s, u) => s + (u.output_tokens || 0), 0);

  console.log(`\n=== COST REPORT (last ${days} day(s)) ===\n`);
  console.log(`Total API calls: ${usage.length}`);
  console.log(`Total input tokens: ${totalInput.toLocaleString()}`);
  console.log(`Total output tokens: ${totalOutput.toLocaleString()}`);
  console.log(`Total cost: $${totalCost.toFixed(4)}`);

  // By purpose
  const byPurpose: Record<string, { calls: number; input: number; output: number; cost: number }> = {};
  for (const u of usage) {
    const p = u.purpose;
    if (!byPurpose[p]) byPurpose[p] = { calls: 0, input: 0, output: 0, cost: 0 };
    byPurpose[p].calls++;
    byPurpose[p].input += u.input_tokens || 0;
    byPurpose[p].output += u.output_tokens || 0;
    byPurpose[p].cost += u.cost_usd || 0;
  }

  console.log('\n--- By Purpose ---');
  const sortedPurpose = Object.entries(byPurpose).sort((a, b) => b[1].cost - a[1].cost);
  for (const [purpose, stats] of sortedPurpose) {
    console.log(`  ${purpose.padEnd(20)} | ${String(stats.calls).padStart(4)} calls | ${stats.input.toLocaleString().padStart(10)} in | ${stats.output.toLocaleString().padStart(10)} out | $${stats.cost.toFixed(4)}`);
  }

  // By model
  const byModel: Record<string, { calls: number; input: number; output: number; cost: number }> = {};
  for (const u of usage) {
    const m = u.model;
    if (!byModel[m]) byModel[m] = { calls: 0, input: 0, output: 0, cost: 0 };
    byModel[m].calls++;
    byModel[m].input += u.input_tokens || 0;
    byModel[m].output += u.output_tokens || 0;
    byModel[m].cost += u.cost_usd || 0;
  }

  console.log('\n--- By Model ---');
  const sortedModel = Object.entries(byModel).sort((a, b) => b[1].cost - a[1].cost);
  for (const [model, stats] of sortedModel) {
    console.log(`  ${model.padEnd(30)} | ${String(stats.calls).padStart(4)} calls | $${stats.cost.toFixed(4)}`);
  }

  // By user
  const byUser: Record<string, { calls: number; cost: number }> = {};
  for (const u of usage) {
    const name = u.user_id ? (nameMap[u.user_id] || u.user_id.slice(0, 8)) : 'system';
    if (!byUser[name]) byUser[name] = { calls: 0, cost: 0 };
    byUser[name].calls++;
    byUser[name].cost += u.cost_usd || 0;
  }

  console.log('\n--- By User ---');
  const sortedUser = Object.entries(byUser).sort((a, b) => b[1].cost - a[1].cost);
  for (const [name, stats] of sortedUser) {
    console.log(`  ${name.padEnd(30)} | ${String(stats.calls).padStart(4)} calls | $${stats.cost.toFixed(4)}`);
  }

  // Per-conversation cost (last 10)
  const byConvo: Record<string, { calls: number; cost: number; user: string }> = {};
  for (const u of usage) {
    if (!u.conversation_id) continue;
    const key = u.conversation_id;
    if (!byConvo[key]) byConvo[key] = { calls: 0, cost: 0, user: nameMap[u.user_id] || u.user_id?.slice(0, 8) || '' };
    byConvo[key].calls++;
    byConvo[key].cost += u.cost_usd || 0;
  }

  if (Object.keys(byConvo).length > 0) {
    console.log('\n--- Top 10 Most Expensive Conversations ---');
    const sortedConvo = Object.entries(byConvo).sort((a, b) => b[1].cost - a[1].cost).slice(0, 10);
    for (const [id, stats] of sortedConvo) {
      console.log(`  ${id.slice(0, 8)} | ${stats.user.padEnd(20)} | ${String(stats.calls).padStart(4)} calls | $${stats.cost.toFixed(4)}`);
    }
  }

  console.log('');
}

main().catch(console.error);
