import { createClient } from '@supabase/supabase-js';
import axios from 'axios';

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

const supabase = createClient(supabaseUrl, supabaseServiceKey);

const GMAIL_API_BASE = 'https://www.googleapis.com/gmail/v1/users/me';

/**
 * Refresh Google OAuth token if expired
 */
async function refreshGoogleToken(refreshToken, userId) {
  try {
    const response = await axios.post('https://oauth2.googleapis.com/token', {
      client_id: process.env.VITE_GOOGLE_OAUTH_CLIENT_ID,
      client_secret: process.env.GOOGLE_OAUTH_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    });

    const newAccessToken = response.data.access_token;

    // Update token in DB
    await supabase
      .from('user_integrations')
      .update({ gmail_access_token: newAccessToken })
      .eq('user_id', userId);

    return newAccessToken;
  } catch (err) {
    console.error('Token refresh failed:', err.message);
    throw err;
  }
}

/**
 * Fetch emails from Gmail and store in Nora database
 */
async function syncGmailEmails(userId, accessToken) {
  try {
    // Get latest email timestamp from Nora to avoid duplicates
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

    // Fetch message list
    const messagesRes = await axios.get(`${GMAIL_API_BASE}/messages`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      params: {
        q: query,
        maxResults: 100,
        fields: 'messages(id)',
      },
    });

    const messageIds = messagesRes.data.messages || [];
    if (!messageIds.length) {
      console.log('No new emails to sync');
      return [];
    }

    // Fetch full message details
    const emailsToInsert = [];
    
    for (const msg of messageIds) {
      try {
        const msgRes = await axios.get(`${GMAIL_API_BASE}/messages/${msg.id}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          params: { format: 'full' },
        });

        const headers = msgRes.data.payload.headers;
        const getHeader = (name) => headers.find(h => h.name === name)?.value || '';

        const receivedDate = new Date(getHeader('Date'));
        
        // Check if already exists
        const { data: existing } = await supabase
          .from('emails')
          .select('id')
          .eq('user_id', userId)
          .eq('gmail_message_id', msg.id)
          .single();

        if (existing) continue;

        // Extract body (simplified — plain text only)
        let body = '';
        if (msgRes.data.payload.parts) {
          const textPart = msgRes.data.payload.parts.find(p => p.mimeType === 'text/plain');
          if (textPart?.body?.data) {
            body = Buffer.from(textPart.body.data, 'base64').toString('utf-8');
          }
        } else if (msgRes.data.payload.body?.data) {
          body = Buffer.from(msgRes.data.payload.body.data, 'base64').toString('utf-8');
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

    // Batch insert
    if (emailsToInsert.length) {
      const { error } = await supabase
        .from('emails')
        .insert(emailsToInsert);

      if (error) throw error;
      console.log(`Synced ${emailsToInsert.length} emails`);
    }

    return emailsToInsert;

  } catch (err) {
    console.error('Gmail sync failed:', err.message);
    throw err;
  }
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

    // Get user's Gmail tokens
    const { data: integration, error: intErr } = await supabase
      .from('user_integrations')
      .select('gmail_access_token, gmail_refresh_token')
      .eq('user_id', user_id)
      .single();

    if (intErr || !integration) {
      return res.status(404).json({ error: 'Gmail not connected' });
    }

    let accessToken = integration.gmail_access_token;

    // Refresh if needed
    if (!accessToken && integration.gmail_refresh_token) {
      accessToken = await refreshGoogleToken(integration.gmail_refresh_token, user_id);
    }

    if (!accessToken) {
      return res.status(401).json({ error: 'No valid Gmail token' });
    }

    // Sync emails
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
