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

  console.log(`[inbound] Webhook payload: ${JSON.stringify(payload).slice(0, 500)}`);

  if ((payload as { type?: string }).type !== 'email.received') {
    return Response.json({ ok: true });
  }

  const data = payload.data as {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
  };

  const { email_id, from: rawFrom, subject } = data;

  // Extract sender email
  const senderEmail = rawFrom.match(/<(.+)>/)?.[1] || rawFrom.trim();

  // Look up user by email
  const sb = getSupabaseAdmin();
  const { data: { users } } = await sb.auth.admin.listUsers();
  const user = users.find(u => u.email === senderEmail);

  if (!user) {
    console.log(`[inbound] Unknown sender: ${senderEmail}`);
    return Response.json({ ok: true });
  }

  // Fetch full email body from Resend API
  let replyText = '';
  try {
    // Received emails use a different API endpoint than sent emails
    const emailResponse = await fetch(
      `https://api.resend.com/emails/${email_id}`,
      { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } },
    );
    const emailData = await emailResponse.json() as Record<string, unknown>;
    console.log(`[inbound] Email API keys: ${Object.keys(emailData).join(', ')}`);
    console.log(`[inbound] Email API status: ${emailResponse.status}`);
    console.log(`[inbound] Email API snippet: ${JSON.stringify(emailData).slice(0, 400)}`);
    replyText = extractReplyText(
      (emailData.text as string) ||
      (emailData.html as string) ||
      (emailData.body as string) ||
      (emailData.text_body as string) ||
      (emailData.html_body as string) ||
      ''
    );
  } catch (err) {
    console.error('[inbound] Failed to fetch email body:', err);
    return Response.json({ error: 'Failed to fetch email' }, { status: 500 });
  }

  if (!replyText.trim()) {
    console.log(`[inbound] Empty reply from ${senderEmail}`);
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
