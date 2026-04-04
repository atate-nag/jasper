// Inbound email webhook: receives replies to Jasper's emails via Resend,
// processes them through the steering pipeline, and responds via email.

import { getSupabaseAdmin } from '@/lib/supabase';
import { Resend } from 'resend';
import { getPersonContext } from '@/lib/backbone';
import { steer } from '@/lib/intermediary';
import { JASPER, buildIdentityPrompt, buildCharacterConfig, isCloneUser } from '@/lib/product/identity';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';
import { logUsage } from '@/lib/usage';
import { getOrCreateConversation, handlePostResponse } from '@/lib/post-response';
import type { Message } from '@/types/message';

let _resend: Resend | null = null;
function getResend(): Resend {
  if (!_resend) _resend = new Resend(process.env.RESEND_API_KEY);
  return _resend;
}

export const maxDuration = 60;

export async function POST(req: Request): Promise<Response> {
  let payload: Record<string, unknown>;
  try {
    payload = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  if ((payload as { type?: string }).type !== 'email.received') {
    console.log(`[inbound] Ignoring non-received event: ${(payload as { type?: string }).type}`);
    return Response.json({ ok: true });
  }

  const steps: string[] = ['webhook_received'];

  try {

  const data = (payload as Record<string, unknown>).data as Record<string, unknown>;
  const email_id = data.email_id as string;
  const rawFrom = data.from as string;
  const subject = data.subject as string;
  const senderEmail = rawFrom.includes('<') ? rawFrom.match(/<(.+)>/)?.[1] || rawFrom : rawFrom.trim();
  steps.push(`sender=${senderEmail}`);

  // Look up user
  const sb = getSupabaseAdmin();
  const { data: authData } = await sb.auth.admin.listUsers();
  const user = authData.users.find(u => u.email === senderEmail);

  if (!user) {
    console.log(`[inbound] ${steps.join(' → ')} → unknown_sender`);
    return Response.json({ ok: true });
  }
  steps.push(`user=${user.id.slice(0, 8)}`);

  // Fetch email body via Resend's received email endpoint
  let replyText = '';
  const receivingUrl = `https://api.resend.com/emails/receiving/${email_id}`;
  const resp = await fetch(receivingUrl, {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  const receivingData = await resp.json() as Record<string, unknown>;
  steps.push(`receiving:${resp.status}`);

  // The API returns text and html fields directly
  const emailText = (receivingData.text as string) || '';
  const emailHtml = (receivingData.html as string) || '';

  if (emailText) {
    replyText = extractReplyText(emailText);
    steps.push(`text=${replyText.length}chars`);
  } else if (emailHtml) {
    // Strip HTML tags as fallback
    const stripped = emailHtml.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&#39;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
    replyText = extractReplyText(stripped);
    steps.push(`html_stripped=${replyText.length}chars`);
  }

  if (!replyText.trim()) {
    console.log(`[inbound] ${steps.join(' → ')} → empty_body`);
    return Response.json({ ok: true });
  }

  console.log(`[inbound] Reply from ${senderEmail}: "${replyText.slice(0, 100)}"`);

  try {
    // Get person context
    const personContext = await getPersonContext(user.id, replyText, []);
    const profileData = personContext.profile as unknown as Record<string, unknown>;
    const charConfig = buildCharacterConfig(profileData);
    const jasperIdentity = {
      ...JASPER,
      identityPrompt: buildIdentityPrompt(charConfig, isCloneUser(profileData)),
    };

    // Get active conversation and history
    const conversationId = await getOrCreateConversation(user.id);
    let sessionHistory: Message[] = [];
    if (conversationId) {
      const { data: conv } = await sb
        .from('conversations')
        .select('messages')
        .eq('id', conversationId)
        .single();
      sessionHistory = (conv?.messages as Message[]) || [];
    }

    const allHistory: Message[] = [
      ...sessionHistory,
      { role: 'user', content: replyText, timestamp: new Date().toISOString() },
    ];

    // Steer
    const steering = await steer(
      replyText, personContext, jasperIdentity, allHistory,
    );

    // Generate response (non-streaming)
    const routing = getModelRouting();
    const result = await callModel(
      routing[steering.modelConfig.tier],
      steering.systemPrompt,
      [
        ...allHistory.slice(0, -1).map(m => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        })),
        { role: 'user' as const, content: steering.reformulatedMessage },
      ],
      steering.modelConfig.temperature,
    );

    logUsage(result.usage, 'email_chat', user.id, conversationId);

    const responseText = result.text;
    const userName = personContext.profile.identity?.name || senderEmail;

    // Send reply email
    const { error: sendError } = await getResend().emails.send({
      from: 'Jasper <jasper@chatwithj.online>',
      to: senderEmail,
      subject: subject.startsWith('Re:') ? subject : `Re: ${subject}`,
      text: responseText + '\n\n—\nJasper\nchatwithj.online',
      replyTo: 'jasper@reply.chatwithj.online',
    });

    if (sendError) {
      console.error(`[inbound] Send failed:`, sendError);
    } else {
      console.log(`[inbound] Replied to ${userName} (${senderEmail})`);
    }

    // Persist to conversation
    handlePostResponse(
      user.id, conversationId, allHistory,
      replyText, responseText, steering, 0, userName,
    ).catch(console.error);

    // Mark re-engagement email as responded
    await sb
      .from('reengagement_emails')
      .update({
        responded: true,
        reengaged_at: new Date().toISOString(),
      })
      .eq('user_id', user.id)
      .is('responded', null);

    return Response.json({ ok: true });
  } catch (err) {
    console.error('[inbound] Pipeline error:', err);
    return Response.json({ error: 'Processing failed' }, { status: 500 });
  }

  } catch (outerErr) {
    console.error('[inbound] OUTER ERROR:', outerErr);
    return Response.json({ error: 'Unexpected error' }, { status: 500 });
  }
}

// Extract the actual reply text, stripping quoted content and signatures
function extractReplyText(text: string): string {
  const markers = [
    /^On .+ wrote:$/m,
    /^-{2,}\s*Original Message/m,
    /^>{1,}\s/m,
    /^From:\s/m,
    /^Sent:\s/m,
    /^-{2,}\s*$/m,
  ];

  let reply = text;
  for (const marker of markers) {
    const match = reply.match(marker);
    if (match?.index !== undefined && match.index > 10) {
      reply = reply.slice(0, match.index);
      break;
    }
  }

  return reply.trim();
}

// Extract plain text body from a raw RFC 822 email
function extractBodyFromRawEmail(raw: string): string {
  // Split headers from body — empty line separates them
  const headerBodySplit = raw.indexOf('\r\n\r\n');
  if (headerBodySplit === -1) {
    const altSplit = raw.indexOf('\n\n');
    if (altSplit === -1) return '';
    return extractReplyText(raw.slice(altSplit + 2));
  }

  const headers = raw.slice(0, headerBodySplit).toLowerCase();
  let body = raw.slice(headerBodySplit + 4);

  // Check if multipart
  const boundaryMatch = headers.match(/boundary="?([^"\s;]+)"?/);
  if (boundaryMatch) {
    const boundary = boundaryMatch[1];
    const parts = body.split('--' + boundary);

    // Find the text/plain part
    for (const part of parts) {
      const partHeaderEnd = part.indexOf('\r\n\r\n') !== -1
        ? part.indexOf('\r\n\r\n')
        : part.indexOf('\n\n');
      if (partHeaderEnd === -1) continue;

      const partHeaders = part.slice(0, partHeaderEnd).toLowerCase();
      const partBody = part.slice(partHeaderEnd + (part.indexOf('\r\n\r\n') !== -1 ? 4 : 2));

      if (partHeaders.includes('text/plain')) {
        // Check for base64 encoding
        if (partHeaders.includes('base64')) {
          body = Buffer.from(partBody.replace(/\s/g, ''), 'base64').toString('utf-8');
        } else if (partHeaders.includes('quoted-printable')) {
          body = partBody.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
            String.fromCharCode(parseInt(hex, 16))
          );
        } else {
          body = partBody;
        }
        return extractReplyText(body);
      }
    }

    // No text/plain found — try text/html and strip tags
    for (const part of parts) {
      const partHeaderEnd = part.indexOf('\r\n\r\n') !== -1
        ? part.indexOf('\r\n\r\n')
        : part.indexOf('\n\n');
      if (partHeaderEnd === -1) continue;

      const partHeaders = part.slice(0, partHeaderEnd).toLowerCase();
      const partBody = part.slice(partHeaderEnd + (part.indexOf('\r\n\r\n') !== -1 ? 4 : 2));

      if (partHeaders.includes('text/html')) {
        let html = partBody;
        if (partHeaders.includes('base64')) {
          html = Buffer.from(html.replace(/\s/g, ''), 'base64').toString('utf-8');
        }
        // Strip HTML tags
        const text = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
        return extractReplyText(text);
      }
    }
  }

  // Not multipart — check content-transfer-encoding
  if (headers.includes('base64')) {
    body = Buffer.from(body.replace(/\s/g, ''), 'base64').toString('utf-8');
  } else if (headers.includes('quoted-printable')) {
    body = body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
  }

  return extractReplyText(body);
}
