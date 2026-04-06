import { jsPDF } from 'jspdf';
import type { Analysis } from '@/lib/reasonqa/types';
import { extractCriticalChains } from './dag/chain-extract';
import { computeLayout } from './dag/layout';

const MARGIN = 20;
const PAGE_W = 210;
const CONTENT_W = PAGE_W - MARGIN * 2;
const LINE_H = 5;

function newPage(doc: jsPDF): number {
  doc.addPage();
  return MARGIN;
}

function checkPage(doc: jsPDF, y: number, needed: number = 20): number {
  if (y + needed > 280) return newPage(doc);
  return y;
}

function heading(doc: jsPDF, text: string, y: number): number {
  y = checkPage(doc, y, 15);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text(text, MARGIN, y);
  return y + 8;
}

function subheading(doc: jsPDF, text: string, y: number): number {
  y = checkPage(doc, y, 12);
  doc.setFontSize(11);
  doc.setFont('helvetica', 'bold');
  doc.text(text, MARGIN, y);
  return y + 6;
}

function body(doc: jsPDF, text: string, y: number, indent: number = 0): number {
  doc.setFontSize(9);
  doc.setFont('helvetica', 'normal');
  const lines = doc.splitTextToSize(text, CONTENT_W - indent);
  for (const line of lines) {
    y = checkPage(doc, y);
    doc.text(line, MARGIN + indent, y);
    y += LINE_H;
  }
  return y;
}

function label(doc: jsPDF, lbl: string, val: string, y: number): number {
  y = checkPage(doc, y);
  doc.setFontSize(9);
  doc.setFont('helvetica', 'bold');
  doc.text(lbl, MARGIN, y);
  doc.setFont('helvetica', 'normal');
  doc.text(val, MARGIN + doc.getTextWidth(lbl) + 2, y);
  return y + LINE_H;
}

export function exportAnalysisPDF(analysis: Analysis): void {
  const { pass1_output: p1, pass2_output: p2, metrics_output: m, pass3_output: p3 } = analysis;
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  let y = MARGIN;

  // ── Title ──────────────────────────────────────────────────
  doc.setFontSize(18);
  doc.setFont('helvetica', 'bold');
  doc.text(analysis.title || 'Untitled Document', MARGIN, y);
  y += 8;

  doc.setFontSize(10);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(120);
  const meta = [
    `Quality: ${p3?.assessment?.quality || 'N/A'}`,
    m ? `${m.totalNodes} claims` : null,
    m ? `${m.totalEdges} connections` : null,
    `Analysed: ${new Date(analysis.created_at).toLocaleDateString('en-GB')}`,
  ].filter(Boolean).join('  |  ');
  doc.text(meta, MARGIN, y);
  doc.setTextColor(0);
  y += 10;

  // ── Summary ────────────────────────────────────────────────
  if (p3?.assessment?.summary) {
    y = heading(doc, 'Summary', y);
    y = body(doc, p3.assessment.summary, y);
    y += 4;
  }

  // ── Issues ─────────────────────────────────────────────────
  const allIssues = [...(p2?.structuralIssues || []), ...(p3?.interpretiveIssues || [])];
  if (allIssues.length > 0) {
    y = heading(doc, `Issues (${allIssues.length})`, y);
    const sorted = [...allIssues].sort((a, b) => {
      const order: Record<string, number> = { high: 0, medium: 1, low: 2 };
      return (order[a.severity] ?? 3) - (order[b.severity] ?? 3);
    });
    for (const issue of sorted) {
      y = checkPage(doc, y, 20);
      y = label(doc, `[${issue.severity.toUpperCase()}] ${issue.issueType}:`, '', y);
      y = body(doc, issue.description, y, 4);
      if (issue.suggestedFix) {
        y = body(doc, `Fix: ${issue.suggestedFix}`, y, 4);
      }
      if (issue.nodeIds.length > 0) {
        y = body(doc, `Nodes: ${issue.nodeIds.join(', ')}`, y, 4);
      }
      y += 2;
    }
  }

  // ── Claims ─────────────────────────────────────────────────
  if (p1?.nodes && p1.nodes.length > 0) {
    y = heading(doc, `Claims (${p1.nodes.length})`, y);
    const vMap = p3 ? new Map(p3.verifications.map(v => [v.nodeId, v])) : new Map();

    for (const node of p1.nodes) {
      y = checkPage(doc, y, 15);
      const v = vMap.get(node.id);
      const typeLabel: Record<string, string> = { F: 'Factual', M: 'Mechanism', V: 'Value', P: 'Prescriptive' };
      const header = [
        node.id,
        typeLabel[node.type] || node.type,
        node.citationStatus !== 'None' ? `${node.citationStatus}: ${node.citationSource || '?'}` : null,
        v ? v.status : null,
      ].filter(Boolean).join('  |  ');

      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.setTextColor(100);
      doc.text(header, MARGIN, y);
      doc.setTextColor(0);
      y += LINE_H;
      y = body(doc, node.text, y, 4);
      y += 1;
    }
  }

  // ── Reasoning Structure (DAG) ───────────────────────────────
  if (p1?.nodes && p2?.edges) {
    const chains = extractCriticalChains(p1.nodes, p2.edges, p3);
    if (chains.length > 0) {
      const layout = computeLayout(
        p1.nodes, p2.edges, chains,
        p2.structuralIssues || [],
        p3?.verifications || [],
      );
      if (layout.nodes.length > 0) {
        // Fit to page width
        const scale = Math.min(CONTENT_W / layout.width, 80 / layout.height, 1);
        const dagHeight = layout.height * scale;

        y = checkPage(doc, y, dagHeight + 20);
        y = heading(doc, 'Reasoning Structure', y);

        const TYPE_COLORS: Record<string, string> = { F: '#6B7280', M: '#F59E0B', V: '#3B82F6', P: '#10B981' };
        const offsetX = MARGIN + (CONTENT_W - layout.width * scale) / 2;

        // Draw edges
        for (const edge of layout.edges) {
          if (edge.points.length >= 2) {
            doc.setDrawColor(edge.isWeakLink ? '#EF4444' : '#9CA3AF');
            doc.setLineWidth(edge.isWeakLink ? 0.5 : 0.2);
            const pts = edge.points;
            for (let i = 0; i < pts.length - 1; i++) {
              doc.line(
                offsetX + pts[i].x * scale, y + pts[i].y * scale,
                offsetX + pts[i + 1].x * scale, y + pts[i + 1].y * scale,
              );
            }
          }
        }

        // Draw nodes
        const nw = 20 * scale;
        const nh = 6 * scale;
        for (const node of layout.nodes) {
          const nx = offsetX + node.x * scale - nw / 2;
          const ny = y + node.y * scale - nh / 2;
          const color = TYPE_COLORS[node.type] || '#6B7280';
          doc.setFillColor(color);
          doc.setDrawColor(color);
          doc.roundedRect(nx, ny, nw, nh, 1, 1, 'F');
          doc.setFontSize(5);
          doc.setTextColor('#FFFFFF');
          doc.text(node.id, nx + nw / 2, ny + nh / 2 + 1, { align: 'center' });
        }

        doc.setTextColor(0);
        y += dagHeight + 4;

        // Legend
        doc.setFontSize(6);
        doc.setTextColor(120);
        doc.text('F=Factual  M=Mechanism  V=Value  P=Prescriptive  Red edge=weak link', MARGIN, y);
        doc.setTextColor(0);
        y += 6;
      }
    }
  }

  // ── Structure ──────────────────────────────────────────────
  if (m) {
    y = heading(doc, 'Structure', y);
    y = label(doc, 'Total claims: ', String(m.totalNodes), y);
    y = label(doc, 'Total connections: ', String(m.totalEdges), y);
    y = label(doc, 'Reasoning edges: ', `${m.reasoningPercent}%`, y);
    y = label(doc, 'Elaboration edges: ', `${m.elaborationPercent}%`, y);
    y = label(doc, 'Max chain depth: ', String(m.maxChainDepth), y);
    y = label(doc, 'Convergence points: ', String(m.convergencePoints.length), y);
    y = label(doc, 'Orphan claims: ', m.orphanNodes.length > 0 ? m.orphanNodes.join(', ') : 'None', y);
    y += 4;
  }

  // ── Verification ───────────────────────────────────────────
  if (p3) {
    y = heading(doc, 'Verification', y);

    // Overall counts
    const a = p3.assessment;
    y = label(doc, 'Verified: ', String(a.totalVerified), y);
    y = label(doc, 'Partial: ', String(a.totalPartial), y);
    y = label(doc, 'Failed: ', String(a.totalFailed), y);
    y = label(doc, 'Ungrounded: ', String(a.totalUngrounded), y);
    y += 4;

    // Corrections
    if (a.correctionsNeeded.length > 0) {
      y = subheading(doc, 'Corrections Needed', y);
      for (let i = 0; i < a.correctionsNeeded.length; i++) {
        y = body(doc, `${i + 1}. ${a.correctionsNeeded[i]}`, y, 4);
      }
      y += 4;
    }

    // Reasoning chains
    if (p3.chainAssessments.length > 0) {
      y = subheading(doc, 'Reasoning Chains', y);
      for (const chain of p3.chainAssessments) {
        y = checkPage(doc, y, 20);
        y = label(doc, `${chain.terminalNodeId}: `, `Depth ${chain.chainDepth}, ${chain.groundingQuality}% grounded`, y);
        y = body(doc, `Weakest link: ${chain.weakestLink.fromId} -> ${chain.weakestLink.toId} — ${chain.weakestLink.reason}`, y, 4);
        if (chain.counterArguments.length > 0) {
          for (const ca of chain.counterArguments) {
            y = body(doc, `- ${ca}`, y, 8);
          }
        }
        y += 2;
      }
      y += 4;
    }

    // Per-citation verifications
    if (p3.verifications.length > 0) {
      y = subheading(doc, `Citation Verifications (${p3.verifications.length})`, y);
      for (const v of p3.verifications) {
        y = checkPage(doc, y, 12);
        const parts = [v.nodeId, v.status, v.failureMode].filter(Boolean).join('  |  ');
        doc.setFontSize(8);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(100);
        doc.text(parts, MARGIN, y);
        doc.setTextColor(0);
        y += LINE_H;
        y = body(doc, v.notes, y, 4);
        y += 1;
      }
    }
  }

  // ── Sources ─────────────────────────────────────────────────
  if (analysis.sources && analysis.sources.length > 0) {
    y = heading(doc, `Sources (${analysis.sources.length})`, y);
    for (const src of analysis.sources) {
      y = checkPage(doc, y, 15);
      const statusText = src.found ? 'RETRIEVED' : 'NOT FOUND';
      y = label(doc, `[${src.refId}] ${statusText}: `, src.citationRaw, y);
      if (src.nodeIds.length > 0) {
        y = body(doc, `Cited by: ${src.nodeIds.join(', ')}`, y, 4);
      }
      if (src.url && src.found) {
        y = body(doc, src.url, y, 4);
      }
      y += 2;
    }
  }

  // ── Footer on each page ────────────────────────────────────
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFontSize(7);
    doc.setTextColor(150);
    doc.text(`ReasonQA  |  Page ${i} of ${pageCount}`, MARGIN, 290);
    doc.setTextColor(0);
  }

  const filename = (analysis.title || 'analysis').replace(/[^a-zA-Z0-9-_ ]/g, '').slice(0, 60);
  doc.save(`${filename} — ReasonQA Report.pdf`);
}
