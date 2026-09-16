import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

  const newAccessToken = data.access_token;

  await supabase
    .from('user_integrations')
    .update({ gmail_access_token: newAccessToken })
    .eq('user_id', userId);

  return newAccessToken;
}

async function syncGmailEmails(userId, accessToken) {
  const { data: latestEmail } = await supabase
    .from('emails')
    .select('received_date')
    .eq('user_id', userId)
    .order('received_date', { ascending: false })
    .limit(1)
    .single();

  const query = latestEmail
    ? `after:${Math.floor(new Date(latestEmail.received_date).getTime() / 1000)}`
    : 'is:all';

  const listUrl = new URL(`${GMAIL_API_BASE}/messages`);
  listUrl.searchParams.set('q', query);
  listUrl.searchParams.set('maxResults', '100');
  listUrl.searchParams.set('fields', 'messages(id)');

  const messagesRes = await fetch(listUrl.toString(), {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const messagesData = await messagesRes.json();
  if (!messagesRes.ok) throw new Error(messagesData.error?.message || 'Failed to list messages');

  const messageIds = messagesData.messages || [];
  if (!messageIds.length) {
    console.log('No new emails to sync');
    return [];
  }

  const emailsToInsert = [];

  for (const msg of messageIds) {
    try {
      const msgUrl = new URL(`${GMAIL_API_BASE}/messages/${msg.id}`);
      msgUrl.searchParams.set('format', 'full');

      const msgRes = await fetch(msgUrl.toString(), {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      const msgData = await msgRes.json();
      if (!msgRes.ok) throw new Error(msgData.error?.message || 'Failed to fetch message');

      const headers = msgData.payload.headers;
      const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

      const receivedDate = new Date(getHeader('Date'));

      const { data: existing } = await supabase
        .from('emails')
        .select('id')
        .eq('user_id', userId)
        .eq('gmail_message_id', msg.id)
        .single();

      if (existing) continue;

      let body = '';
      if (msgData.payload.parts) {
        const textPart = msgData.payload.parts.find(p => p.mimeType === 'text/plain');
        if (textPart?.body?.data) {
          body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
        }
      } else if (msgData.payload.body?.data) {
        body = Buffer.from(msgData.payload.body.data, 'base64').toString('utf-8');
      }

      emailsToInsert.push({
        user_id: userId,
        gmail_message_id: msg.id,
        sender: getHeader('From'),
        subject: getHeader('Subject'),
        body,
        received_date: receivedDate.toISOString(),
        source: 'gmail',
      });
    } catch (err) {
      console.error(`Failed to fetch message ${msg.id}:`, err.message);
    }
  }

  if (emailsToInsert.length) {
    const { error } = await supabase
      .from('emails')
      .insert(emailsToInsert);

    if (error) throw error;
    console.log(`Synced ${emailsToInsert.length} emails`);
  }

  return emailsToInsert;
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

    if (!accessToken && integration.gmail_refresh_token) {
      accessToken = await refreshGoogleToken(integration.gmail_refresh_token, user_id);
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid Gmail token' });
    }

    const synced = await syncGmailEmails(user_id, accessToken);

    return res.status(200).json({
      success: true,
      synced_count: synced.length,
    });

  } catch (error) {
    console.error('Sync Gmail error:', error);
    return res.status(500).json({ error: error.message });
  }
}
