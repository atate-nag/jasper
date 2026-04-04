# Inbound Email — Specification

## What Happens

1. Jasper sends a re-engagement email from `jasper@chatwithj.online`
2. User replies to the email
3. Resend receives the reply, fires a webhook to `/api/email/inbound`
4. The endpoint identifies the user, extracts the reply text, creates a conversation turn
5. Jasper generates a response using the same steering pipeline as web chat
6. Jasper replies via email

The user never needs to log in. They reply to an email, get a response from Jasper, reply again. Async conversation over email.

## DNS Setup

Add an MX record in Porkbun for `chatwithj.online` pointing to Resend's inbound servers. Since the domain already has MX records (if any), consider using a subdomain `reply.chatwithj.online` to avoid conflicts:

```
reply.chatwithj.online  MX  10  inbound.resend.dev
```

Then verify in Resend dashboard under Receiving > Custom Domains.

Alternatively, use the main domain if no existing MX records conflict.

## Resend Webhook Setup

1. In Resend dashboard > Webhooks > Add Webhook
2. URL: `https://chatwithj.online/api/email/inbound`
3. Event: `email.received`
4. Copy the webhook signing secret → set as `RESEND_WEBHOOK_SECRET` in Vercel

## Implementation

### Webhook endpoint: `/api/email/inbound`

```typescript
// src/app/api/email/inbound/route.ts

import { getSupabaseAdmin } from '@/lib/supabase';
import { Resend } from 'resend';
import { getPersonContext } from '@/lib/backbone';
import { steer } from '@/lib/intermediary';
import { JASPER, buildIdentityPrompt, buildCharacterConfig, isCloneUser }
  from '@/lib/product/identity';
import { callModel } from '@/lib/model-client';
import { getModelRouting } from '@/lib/config/models';
import { logUsage } from '@/lib/usage';
import { getOrCreateConversation, handlePostResponse }
  from '@/lib/post-response';
import type { Message } from '@/types/message';

const resend = new Resend(process.env.RESEND_API_KEY);

export async function POST(req: Request): Promise<Response> {
  // 1. Parse webhook payload
  const payload = await req.json();

  if (payload.type !== 'email.received') {
    return Response.json({ ok: true });
  }

  const { email_id, from, subject } = payload.data;

  // 2. Extract sender email
  const senderEmail = from.match(/<(.+)>/)?.[1] || from;

  // 3. Look up user by email
  const sb = getSupabaseAdmin();
  const { data: { users } } = await sb.auth.admin.listUsers();
  const user = users.find(u => u.email === senderEmail);

  if (!user) {
    console.log(`[inbound] Unknown sender: ${senderEmail}`);
    return Response.json({ ok: true }); // don't error — could be spam
  }

  // 4. Fetch full email body from Resend API
  const emailResponse = await fetch(
    `https://api.resend.com/emails/${email_id}`,
    { headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` } }
  );
  const emailData = await emailResponse.json();
  const replyText = extractReplyText(emailData.text || emailData.html || '');

  if (!replyText.trim()) {
    console.log(`[inbound] Empty reply from ${senderEmail}`);
    return Response.json({ ok: true });
  }

  console.log(`[inbound] Reply from ${senderEmail}: "${replyText.slice(0, 100)}"`);

  // 5. Get person context and steer
  const personContext = await getPersonContext(user.id, replyText, []);
  const profileData = personContext.profile as unknown as Record<string, unknown>;
  const charConfig = buildCharacterConfig(profileData);
  const jasperIdentity = {
    ...JASPER,
    identityPrompt: buildIdentityPrompt(charConfig, isCloneUser(profileData)),
  };

  // Build session history from recent conversation
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

  const steering = await steer(
    replyText, personContext, jasperIdentity, allHistory
  );

  // 6. Generate response (non-streaming)
  const routing = getModelRouting();
  const result = await callModel(
    routing[steering.modelConfig.tier],
    steering.systemPrompt,
    [
      ...allHistory.slice(0, -1).map(m => ({
        role: m.role, content: m.content
      })),
      { role: 'user', content: steering.reformulatedMessage },
    ],
    steering.modelConfig.temperature,
  );

  logUsage(result.usage, 'email_chat', user.id, conversationId);

  const responseText = result.text;

  // 7. Send reply email
  const userName = personContext.profile.identity?.name || senderEmail;
  await resend.emails.send({
    from: 'Jasper <jasper@chatwithj.online>',
    to: senderEmail,
    subject: `Re: ${subject}`,
    text: responseText + '\n\n—\nJasper\nchatwithj.online',
    replyTo: 'jasper@chatwithj.online',
  });

  console.log(`[inbound] Replied to ${userName} (${senderEmail})`);

  // 8. Persist to conversation
  const responseLatencyMs = 0; // not meaningful for async
  await handlePostResponse(
    user.id, conversationId, allHistory,
    replyText, responseText, steering, responseLatencyMs, userName,
  );

  // 9. Log to reengagement_emails if this is a reply to one
  await sb
    .from('reengagement_emails')
    .update({
      responded: true,
      reengaged_at: new Date().toISOString(),
    })
    .eq('user_id', user.id)
    .is('responded', null);

  return Response.json({ ok: true });
}

// Extract the actual reply text, stripping quoted content
function extractReplyText(text: string): string {
  // Common reply markers
  const markers = [
    /^On .+ wrote:$/m,           // "On Mon, Apr 4... wrote:"
    /^-{2,}\s*Original Message/m, // "-- Original Message --"
    /^>{1,}/m,                    // "> quoted text"
    /^From: /m,                   // "From: sender"
    /^Sent: /m,                   // "Sent: date"
  ];

  let reply = text;
  for (const marker of markers) {
    const match = reply.match(marker);
    if (match?.index !== undefined && match.index > 0) {
      reply = reply.slice(0, match.index);
      break;
    }
  }

  return reply.trim();
}
```

## Email Threading

For proper Gmail/Outlook threading (replies appear in the same thread as the original):

```typescript
// When sending the initial re-engagement email, store the Message-ID
const { data } = await resend.emails.send({
  from: 'Jasper <jasper@chatwithj.online>',
  to: email,
  subject: subject,
  text: body,
  headers: {
    'Message-ID': `<jasper-${conversationId}@chatwithj.online>`,
  },
});

// When replying, reference the original
await resend.emails.send({
  from: 'Jasper <jasper@chatwithj.online>',
  to: senderEmail,
  subject: `Re: ${subject}`,
  text: responseText,
  headers: {
    'In-Reply-To': originalMessageId,
    'References': originalMessageId,
  },
});
```

## What the User Experiences

1. Gets an email from "Jasper <jasper@chatwithj.online>"
2. Replies normally from their email client
3. Gets a response from Jasper within 30-60 seconds
4. Can continue replying — full async conversation
5. The conversation is also visible in their web chat history

## Constraints

- **No streaming** — email responses are always complete
- **No voice** — text only
- **Reply parsing** — email clients add quoted text, signatures, etc. The `extractReplyText` function strips these but won't be perfect
- **Rate limits** — Resend free tier: 100 emails/day combined sent+received. Upgrade to Pro ($20/mo) for 50K/month
- **Latency** — webhook fires immediately, but steering + model call takes 5-15 seconds. User won't notice since it's async

## Build Order

1. Add MX record in Porkbun
2. Verify domain in Resend dashboard
3. Add `RESEND_WEBHOOK_SECRET` to Vercel
4. Build the webhook endpoint
5. Test: reply to Adrian's test email, verify response arrives
6. Deploy and send re-engagement emails

## Cost

- Resend: free tier covers this easily
- Model: same as a web chat turn (~$0.01-0.05 per reply depending on tier)
- Per email conversation (5 exchanges): ~$0.10-0.25
