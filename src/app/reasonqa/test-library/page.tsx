import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';
import { readFileSync, existsSync, readdirSync } from 'fs';
import Link from 'next/link';

export const dynamic = 'force-dynamic';

interface TPDetail { description: string; severity: 'fatal' | 'significant' | 'minor' }
interface FNDetail { description: string; category: 'missing_context' | 'structural_flaw' | 'judgment_call' | 'depth_gap' }
interface FPDetail { description: string; failureMode: 'over_formalization' | 'misread_citation' | 'scope_error' | 'threshold_too_low' | 'other' }

interface CaseEntry {
  name: string; id?: string; quality: string; claims: number; edges: number;
  structuralIssues: number; interpretiveIssues: number; rating: number;
  truePositives: TPDetail[]; falseNegatives: FNDetail[]; falsePositives: FPDetail[];
  additionalFindings: number; keyInsight: string; hasComparison: boolean;
  externalCitations: number; uniqueAuthorities: number; maxChainDepth: number;
  domain: string; totalDurationMs: number;
}

const Q_COLOR: Record<string, string> = { STRONG: 'text-[#2D7D46]', ADEQUATE: 'text-[#5B7BA3]', MARGINAL: 'text-[#B8860B]', WEAK: 'text-[#A63D40]' };
const R_COLOR: Record<number, string> = { 5: 'text-[#2D7D46]', 4: 'text-[#2D7D46]', 3: 'text-[#B8860B]', 2: 'text-[#A63D40]', 1: 'text-[#A63D40]' };

export default async function TestLibraryPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect('/login');

  // Load from file index
  const libDir = 'scripts/test-library';
  let cases: CaseEntry[] = [];
  if (existsSync(`${libDir}/index.json`)) {
    cases = JSON.parse(readFileSync(`${libDir}/index.json`, 'utf-8'));
  } else if (existsSync(libDir)) {
    const dirs = readdirSync(libDir, { withFileTypes: true }).filter(d => d.isDirectory() && d.name !== 'judgments');
    for (const d of dirs) {
      const sp = `${libDir}/${d.name}/summary.json`;
      if (existsSync(sp)) cases.push(JSON.parse(readFileSync(sp, 'utf-8')));
    }
  }

  const compared = cases.filter(c => c.hasComparison && c.rating > 0);
  const allTP = compared.flatMap(c => c.truePositives || []);
  const allFN = compared.flatMap(c => c.falseNegatives || []);
  const allFP = compared.flatMap(c => c.falsePositives || []);
  const avgRating = compared.length > 0 ? (compared.reduce((s, c) => s + c.rating, 0) / compared.length).toFixed(1) : '—';
  const precision = allTP.length + allFP.length > 0 ? Math.round((allTP.length / (allTP.length + allFP.length)) * 100) : 0;
  const recall = allTP.length + allFN.length > 0 ? Math.round((allTP.length / (allTP.length + allFN.length)) * 100) : 0;

  // Breakdowns
  const tpFatal = allTP.filter(t => t.severity === 'fatal').length;
  const tpSig = allTP.filter(t => t.severity === 'significant').length;
  const tpMinor = allTP.filter(t => t.severity === 'minor').length;
  const fnCats = allFN.reduce((a, f) => { a[f.category] = (a[f.category] || 0) + 1; return a; }, {} as Record<string, number>);
  const fpModes = allFP.reduce((a, f) => { a[f.failureMode] = (a[f.failureMode] || 0) + 1; return a; }, {} as Record<string, number>);

  return (
    <div>
      <h1 className="text-2xl font-semibold text-[#1A1A2E]" style={{ fontFamily: 'var(--font-serif)' }}>
        Test Library
      </h1>
      <p className="mt-1 text-sm text-[#8B8BA3]">{cases.length} cases, {compared.length} with comparisons</p>

      {/* Aggregate metrics */}
      {compared.length > 0 && (
        <>
          <div className="mt-6 grid gap-4 sm:grid-cols-4">
            <StatCard label="Avg Rating" value={`${avgRating}/5`} />
            <StatCard label="Precision" value={`${precision}%`} sub={`${allTP.length} TP / ${allTP.length + allFP.length} flagged`} />
            <StatCard label="Recall" value={`${recall}%`} sub={`${allTP.length} TP / ${allTP.length + allFN.length} real issues`} />
            <StatCard label="Cases" value={String(compared.length)} sub="with comparisons" />
          </div>

          {/* Diagnostic breakdowns */}
          <div className="mt-6 grid gap-4 sm:grid-cols-3">
            {/* TP severity */}
            <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">True Positives by Severity</p>
              <div className="mt-3 space-y-1.5">
                <Bar label="Fatal" count={tpFatal} total={allTP.length} color="bg-[#A63D40]" />
                <Bar label="Significant" count={tpSig} total={allTP.length} color="bg-[#B8860B]" />
                <Bar label="Minor" count={tpMinor} total={allTP.length} color="bg-[#8B8BA3]" />
              </div>
            </div>

            {/* FN categories */}
            <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">False Negatives by Category</p>
              <div className="mt-3 space-y-1.5">
                <Bar label="Structural flaw" count={fnCats.structural_flaw || 0} total={allFN.length} color="bg-[#A63D40]" />
                <Bar label="Depth gap" count={fnCats.depth_gap || 0} total={allFN.length} color="bg-[#B8860B]" />
                <Bar label="Missing context" count={fnCats.missing_context || 0} total={allFN.length} color="bg-[#5B7BA3]" />
                <Bar label="Judgment call" count={fnCats.judgment_call || 0} total={allFN.length} color="bg-[#8B8BA3]" />
              </div>
            </div>

            {/* FP failure modes */}
            <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">False Positives by Mode</p>
              <div className="mt-3 space-y-1.5">
                <Bar label="Over-formalization" count={fpModes.over_formalization || 0} total={allFP.length} color="bg-[#B8860B]" />
                <Bar label="Threshold too low" count={fpModes.threshold_too_low || 0} total={allFP.length} color="bg-[#5B7BA3]" />
                <Bar label="Scope error" count={fpModes.scope_error || 0} total={allFP.length} color="bg-[#8B8BA3]" />
                <Bar label="Misread citation" count={fpModes.misread_citation || 0} total={allFP.length} color="bg-[#A63D40]" />
                <Bar label="Other" count={fpModes.other || 0} total={allFP.length} color="bg-[#D1D5DB]" />
              </div>
            </div>
          </div>
        </>
      )}

      {/* Per-case table */}
      <div className="mt-8 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[#E5E7EB] text-left text-xs font-semibold uppercase tracking-wide text-[#8B8BA3]">
              <th className="pb-3 pr-3">Case</th>
              <th className="pb-3 pr-3">Domain</th>
              <th className="pb-3 pr-3">Quality</th>
              <th className="pb-3 pr-3 text-right">Rating</th>
              <th className="pb-3 pr-3 text-right">Claims</th>
              <th className="pb-3 pr-3 text-right">Auth</th>
              <th className="pb-3 pr-3 text-right">Depth</th>
              <th className="pb-3 pr-3 text-right">TP</th>
              <th className="pb-3 pr-3 text-right">FN</th>
              <th className="pb-3 pr-3 text-right">FP</th>
              <th className="pb-3 pr-3 text-right">Time</th>
              <th className="pb-3">Insight</th>
            </tr>
          </thead>
          <tbody>
            {cases.map((c, i) => {
              const tp = c.truePositives?.length || 0;
              const fn = c.falseNegatives?.length || 0;
              const fp = c.falsePositives?.length || 0;
              const tpF = (c.truePositives || []).filter(t => t.severity === 'fatal').length;
              const fnS = (c.falseNegatives || []).filter(f => f.category === 'structural_flaw').length;
              const fpO = (c.falsePositives || []).filter(f => f.failureMode === 'over_formalization').length;
              const dur = c.totalDurationMs > 0 ? `${(c.totalDurationMs / 60000).toFixed(1)}m` : '—';

              return (
                <tr key={i} className={`border-b border-[#F1F3F5] ${i % 2 === 0 ? 'bg-white' : 'bg-[#FAFBFC]'}`}>
                  <td className="py-3 pr-3">
                    {c.id ? (
                      <Link href={`/reasonqa/analysis/${c.id}`} className="font-medium text-[#1B2A4A] hover:underline">
                        {c.name.replace(/_/g, ' ')}
                      </Link>
                    ) : (
                      <span className="font-medium text-[#1A1A2E]">{c.name.replace(/_/g, ' ')}</span>
                    )}
                  </td>
                  <td className="py-3 pr-3 text-xs text-[#8B8BA3]">{c.domain || '—'}</td>
                  <td className={`py-3 pr-3 font-semibold ${Q_COLOR[c.quality] || 'text-[#8B8BA3]'}`}>{c.quality}</td>
                  <td className={`py-3 pr-3 text-right font-semibold ${R_COLOR[c.rating] || 'text-[#D1D5DB]'}`}>{c.rating || '—'}</td>
                  <td className="py-3 pr-3 text-right text-[#4A4A68]">{c.claims}</td>
                  <td className="py-3 pr-3 text-right text-[#4A4A68]">{c.uniqueAuthorities || '—'}</td>
                  <td className="py-3 pr-3 text-right text-[#4A4A68]">{c.maxChainDepth || '—'}</td>
                  <td className="py-3 pr-3 text-right">
                    <span className="text-[#2D7D46]">{tp}</span>
                    {tpF > 0 && <span className="ml-1 text-xs text-[#A63D40]">({tpF}F)</span>}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <span className="text-[#A63D40]">{fn}</span>
                    {fnS > 0 && <span className="ml-1 text-xs text-[#A63D40]">({fnS}S)</span>}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <span className="text-[#B8860B]">{fp}</span>
                    {fpO > 0 && <span className="ml-1 text-xs text-[#B8860B]">({fpO}O)</span>}
                  </td>
                  <td className="py-3 pr-3 text-right text-[#8B8BA3]">{dur}</td>
                  <td className="py-3 max-w-xs truncate text-xs text-[#8B8BA3]" title={c.keyInsight}>{c.keyInsight || '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Legend */}
      <div className="mt-4 text-xs text-[#8B8BA3]">
        <p>TP = true positives (F = fatal severity). FN = false negatives (S = structural flaws). FP = false positives (O = over-formalization). Auth = unique authorities cited. Depth = max reasoning chain depth.</p>
      </div>

      {compared.length === 0 && (
        <p className="mt-4 text-sm text-[#8B8BA3]">
          Run <code className="rounded bg-[#F1F3F5] px-1 py-0.5 text-xs">npx tsx scripts/run-test-case.ts judgment.pdf</code> then <code className="rounded bg-[#F1F3F5] px-1 py-0.5 text-xs">npx tsx scripts/extract-comparison-stats.ts</code>
        </p>
      )}
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded border border-[#E5E7EB] bg-[#FAFBFC] p-4">
      <p className="text-xl font-semibold text-[#1A1A2E]">{value}</p>
      <p className="mt-1 text-xs text-[#8B8BA3]">{label}</p>
      {sub && <p className="text-xs text-[#D1D5DB]">{sub}</p>}
    </div>
  );
}

function Bar({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <span className="w-28 text-xs text-[#4A4A68]">{label}</span>
      <div className="flex-1 h-2 rounded-full bg-[#F1F3F5] overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="w-8 text-right text-xs text-[#8B8BA3]">{count}</span>
    </div>
  );
}
