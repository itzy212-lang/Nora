import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_BASE_URL = process.env.APP_BASE_URL || 'https://nora-d9wy.vercel.app';

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

async function refreshGoogleToken(refreshToken, userId) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(data.error_description || data.error || 'Token refresh failed');

  await supabase
    .from('user_integrations')
    .update({ gmail_access_token: data.access_token })
    .eq('user_id', userId);

  return data.access_token;
}

function parseEmailAddress(headerValue) {
  // "Name <email@domain.com>" or just "email@domain.com"
  if (!headerValue) return { name: '', email: '' };
  const match = headerValue.match(/^(.*?)\s*<(.+)>$/);
  if (match) {
    return { name: match[1].replace(/"/g, '').trim(), email: match[2].trim() };
  }
  return { name: '', email: headerValue.trim() };
}

function parseEmailList(headerValue) {
  if (!headerValue) return [];
  return headerValue.split(',').map(part => parseEmailAddress(part.trim())).filter(r => r.email);
}

function looksLikeReplyOrForward(subject) {
  return /^\s*(re|fw|fwd)\s*:/i.test(subject || '');
}

async function inheritThreadProject(threadId, emailId, subject) {
  if (!threadId || !looksLikeReplyOrForward(subject)) return null;
  try {
    const { data } = await supabase
      .from('emails')
      .select('project_id')
      .eq('thread_id', threadId)
      .not('project_id', 'is', null)
      .limit(1)
      .maybeSingle();

    if (!data?.project_id) return null;

    await supabase
      .from('emails')
      .update({
        project_id: data.project_id,
        link_status: 'auto_linked',
        project_match_confidence: 95,
        project_match_source: 'thread_inherited',
      })
      .eq('id', emailId);

    return data.project_id;
  } catch (err) {
    console.warn('Thread inherit failed:', err.message);
    return null;
  }
}

async function matchByPartyEmail(senderEmail, emailId) {
  if (!senderEmail) return null;
  const email = senderEmail.toLowerCase().trim();
  try {
    const { data: boMatches } = await supabase
      .from('projects')
      .select('id')
      .or(`bo_1_email.ilike.${email},bo_2_email.ilike.${email}`)
      .limit(2);

    if (boMatches?.length === 1) {
      await supabase
        .from('emails')
        .update({ project_id: boMatches[0].id, link_status: 'auto_linked', project_match_confidence: 92, project_match_source: 'bo_email_match' })
        .eq('id', emailId);
      return boMatches[0].id;
    }

    const { data: allProjects } = await supabase
      .from('projects')
      .select('id, aos')
      .not('aos', 'eq', '[]')
      .limit(200);

    const aoMatches = [];
    for (const project of allProjects || []) {
      const aos = Array.isArray(project.aos) ? project.aos : [];
      const matched = aos.some((ao) => {
        const aoEmail = (ao.email || '').toLowerCase().trim();
        const aoEmail2 = (ao.email2 || '').toLowerCase().trim();
        return (aoEmail && aoEmail === email) || (aoEmail2 && aoEmail2 === email);
      });
      if (matched) aoMatches.push(project.id);
    }

    if (aoMatches.length === 1) {
      await supabase
        .from('emails')
        .update({ project_id: aoMatches[0], link_status: 'auto_linked', project_match_confidence: 88, project_match_source: 'ao_email_match' })
        .eq('id', emailId);
      return aoMatches[0];
    }

    return null;
  } catch (err) {
    console.warn('Party email match failed:', err.message);
    return null;
  }
}

async function embedEmail(emailId) {
  try {
    await fetch(`${APP_BASE_URL}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'embed_record', record_id: emailId, table: 'emails' }),
    });
  } catch (err) {
    console.warn('Embed error (non-fatal):', err.message);
  }
}

function extractBody(payload) {
  if (!payload) return { body: '', bodyPreview: '' };

  const findPart = (parts, mimeType) => {
    for (const part of parts || []) {
      if (part.mimeType === mimeType && part.body?.data) return part;
      if (part.parts) {
        const nested = findPart(part.parts, mimeType);
        if (nested) return nested;
      }
    }
    return null;
  };

  let body = '';
  if (payload.parts) {
    const htmlPart = findPart(payload.parts, 'text/html');
    const textPart = findPart(payload.parts, 'text/plain');
    const chosen = htmlPart || textPart;
    if (chosen?.body?.data) {
      body = Buffer.from(chosen.body.data, 'base64').toString('utf-8');
    }
  } else if (payload.body?.data) {
    body = Buffer.from(payload.body.data, 'base64').toString('utf-8');
  }

  const bodyPreview = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  return { body, bodyPreview };
}

async function syncGmailEmails(userId, accessToken) {
  const { data: account } = await supabase
    .from('user_integrations')
    .select('gmail_last_synced_at')
    .eq('user_id', userId)
    .single();

  const lastSync = account?.gmail_last_synced_at
    ? new Date(account.gmail_last_synced_at)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const afterEpoch = Math.floor((lastSync.getTime() - 2 * 60 * 1000) / 1000);
  // Gmail's after: operator is documented for YYYY/MM/DD; epoch seconds
  // work in practice but are undocumented and have been unreliable, so
  // use the documented date format instead.
  const afterDate = new Date((lastSync.getTime() - 2 * 60 * 1000));
  const afterDateStr = `${afterDate.getUTCFullYear()}/${String(afterDate.getUTCMonth() + 1).padStart(2, '0')}/${String(afterDate.getUTCDate()).padStart(2, '0')}`;
  const query = `after:${afterDateStr}`;

  const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', '50');
  listUrl.searchParams.set('fields', 'messages(id),resultSizeEstimate');

  const messagesRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const messagesText = await messagesRes.text();
  // Gmail's partial-response (fields=) can return an empty body when there
  // are zero matches instead of "{}" — guard against that before parsing.
  const messagesData = messagesText ? JSON.parse(messagesText) : {};
  if (!messagesRes.ok) throw new Error(messagesData.error?.message || 'Failed to list messages');

  try {
    const debugIds = (messagesData.messages || []).map(m => m.id);
    const debugDetails = [];
    for (const id of debugIds.slice(0, 5)) {
      const dRes = await fetch(`${GMAIL_API_BASE}/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const dData = await dRes.json();
      debugDetails.push({
        id,
        internalDate: dData.internalDate,
        headers: dData.payload?.headers,
        labelIds: dData.labelIds,
      });
    }
    await supabase.from('oauth_debug').insert({
      event: 'gmail_message_details',
      response_data: { debugDetails },
    });
  } catch (e) {
    await supabase.from('oauth_debug').insert({ event: 'gmail_debug_error', response_data: { message: e.message } });
  }

  try {
    await supabase.from('oauth_debug').insert({
      event: 'gmail_list_messages',
      response_data: { query, listUrl: listUrl.toString(), status: messagesRes.status, body: messagesData },
    });
  } catch (e) {}

  const messageIds = messagesData.messages || [];
  let processed = 0, skipped = 0, failed = 0, threadLinked = 0, partyLinked = 0;

  for (const msg of messageIds) {
    try {
      const { data: existing } = await supabase
        .from('emails')
        .select('id')
        .eq('external_id', msg.id)
        .maybeSingle();

      if (existing) { skipped++; continue; }

      const msgUrl = new URL(`${GMAIL_API_BASE}/messages/${msg.id}`);
      msgUrl.searchParams.set('format', 'full');

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const msgData = await msgRes.json();
      if (!msgRes.ok) throw new Error(msgData.error?.message || 'Failed to fetch message');

      const headers = msgData.payload.headers || [];
      const getHeader = (name) => headers.find(h => h.name?.toLowerCase() === name.toLowerCase())?.value || '';

      const from = parseEmailAddress(getHeader('From'));
      const toList = parseEmailList(getHeader('To'));
      const ccList = parseEmailList(getHeader('Cc'));
      const bccList = parseEmailList(getHeader('Bcc'));
      const replyToList = parseEmailList(getHeader('Reply-To'));

      const receivedAt = getHeader('Date') ? new Date(getHeader('Date')) : new Date(Number(msgData.internalDate));
      const subject = getHeader('Subject') || '(No subject)';
      const { body, bodyPreview } = extractBody(msgData.payload);

      const rawRecipients = {
        from: { name: from.name, email: from.email },
        to: toList,
        cc: ccList,
        bcc: bccList,
        reply_to: replyToList,
      };

      const { data: inserted, error: insertErr } = await supabase
        .from('emails')
        .insert({
          user_id: userId,
          provider: 'gmail',
          external_id: msg.id,
          thread_id: msgData.threadId || null,
          subject,
          sender_email: from.email,
          sender_name: from.name,
          to_email: toList.map(r => r.email).join('; '),
          to_emails: toList,
          cc_emails: ccList.map(r => r.email).join('; ') || null,
          bcc_emails: bccList.map(r => r.email).join('; ') || null,
          reply_to_emails: replyToList.map(r => r.email).join('; ') || null,
          raw_recipients: rawRecipients,
          body,
          body_preview: bodyPreview,
          received_at: receivedAt.toISOString(),
          is_read: !(msgData.labelIds || []).includes('UNREAD'),
          direction: (msgData.labelIds || []).includes('SENT') ? 'outgoing' : 'incoming',
        })
        .select('id')
        .single();

      if (insertErr) {
        console.error('Insert failed:', insertErr.message);
        failed++;
        continue;
      }

      processed++;
      embedEmail(inserted.id);

      let linked = false;
      if (msgData.threadId) {
        const inherited = await inheritThreadProject(msgData.threadId, inserted.id, subject);
        if (inherited) { threadLinked++; linked = true; }
      }
      if (!linked && from.email) {
        const partyMatch = await matchByPartyEmail(from.email, inserted.id);
        if (partyMatch) partyLinked++;
      }
    } catch (err) {
      console.error(`Failed to process message ${msg.id}:`, err.message);
      failed++;
    }
  }

  await supabase
    .from('user_integrations')
    .update({ gmail_last_synced_at: new Date().toISOString() })
    .eq('user_id', userId);

  // Trigger the same cross-provider auto-link pass Outlook uses
  try {
    await fetch(`${supabaseUrl}/functions/v1/auto-link-emails`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${supabaseServiceKey}`,
      },
      body: '{}',
    });
  } catch (err) {
    console.warn('auto-link-emails trigger failed (non-fatal):', err.message);
  }

  return { processed, skipped, failed, threadLinked, partyLinked };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', req.headers.origin || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { user_id } = req.body;

    if (!user_id) {
      return res.status(400).json({ error: 'Missing user_id' });
    }

    const { data: integration, error: intErr } = await supabase
      .from('user_integrations')
      .select('gmail_access_token, gmail_refresh_token')
      .eq('user_id', user_id)
      .single();

    if (intErr || !integration) {
      return res.status(404).json({ error: 'Gmail not connected' });
    }

    let accessToken = integration.gmail_access_token;

    if (integration.gmail_refresh_token) {
      // Always refresh — Gmail access tokens are short-lived (1hr) and
      // we don't currently track expiry, so refresh proactively.
      try {
        accessToken = await refreshGoogleToken(integration.gmail_refresh_token, user_id);
      } catch (err) {
        console.warn('Token refresh failed, trying existing token:', err.message);
      }
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid Gmail token' });
    }

    const result = await syncGmailEmails(user_id, accessToken);

    return res.status(200).json({
      success: true,
      newEmails: result.processed,
      skippedEmails: result.skipped,
      failedEmails: result.failed,
      threadLinked: result.threadLinked,
      partyLinked: result.partyLinked,
    });

  } catch (error) {
    console.error('Sync Gmail error:', error);
    return res.status(500).json({ error: error.message });
  }
}
