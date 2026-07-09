import { useState, useCallback, useEffect, useRef } from 'react';
import { useApp } from '../state/appStore';
import sb from '../supabaseClient';

// ── Brain helpers ──────────────────────────────────────────────────────────

async function saveEmailToBrain(projectId, role, subject, body, fromTo) {
  if (!projectId || !sb) return;
  try {
    const content = [
      subject ? `Subject: ${subject}` : '',
      fromTo ? fromTo : '',
      body ? body.slice(0, 8000) : '',
    ].filter(Boolean).join('\n');

    await sb.from('project_brain').insert({
      project_id: projectId,
      role,
      content,
      content_type: role === 'user' ? 'email_sent' : 'email_received',
      is_summary: false,
    });
  } catch {
    // never block email operations
  }
}

export function useEmails() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);

  // ── Proactive token refresh ──────────────────────────────────────────────
  // Silently refresh the Microsoft token if it's expired or expiring within
  // 15 minutes, without waiting for an explicit sync request
  const ensureTokenFresh = useCallback(async () => {
    if (!sb) return;
    try {
      const { data: accounts } = await sb
        .from('email_accounts')
        .select('id, token_expires_at, reconnect_required')
        .eq('provider', 'outlook')
        .limit(1);

      const account = accounts?.[0];
      if (!account || account.reconnect_required) return;

      const expires = account.token_expires_at ? new Date(account.token_expires_at) : null;
      const refreshThreshold = new Date(Date.now() + 15 * 60 * 1000); // 15 min buffer

      if (!expires || expires < refreshThreshold) {
        // Token expired or expiring soon — trigger a sync to refresh it
        console.log('[useEmails] Token expired/expiring — triggering silent refresh');
        await sb.functions.invoke('sync_outlook', { body: {} }).catch(() => {});
      }
    } catch {
      // Never block — this is best-effort
    }
  }, []);

  const loadEmails = useCallback(async ({ force = false } = {}) => {
    if (!sb) return;
    // Proactively refresh token if needed before loading
    await ensureTokenFresh();
    // Skip if already loaded this session — rely on sync for updates
    if (!force && state.emails && state.emails.length > 0) return state.emails;
    setLoading(true);
    try {
      let res = await sb
        .from('emails')
        .select('*')
        .order('received_at', { ascending: false })
        .limit(200);

      if (res.error) {
        res = await sb
          .from('emails')
          .select('*')
          .order('received_at', { ascending: false })
          .limit(200);
      }

      const rows = (res.data || []).map(normalizeEmail);
      dispatch({ type: 'SET_EMAILS', payload: rows });
      return rows;
    } catch (err) {
      console.error('[useEmails] load failed:', err);
      return [];
    } finally {
      setLoading(false);
    }
  }, [dispatch, state.emails]);

  const syncOutlook = useCallback(async () => {
    if (!sb) return;
    try {
      const { data, error } = await sb.functions.invoke('sync_outlook', {
        body: { user_id: state.currentUser?.email || state.currentUser?.id },
      });
      if (error) throw error;

      // If no new emails, don't touch state at all
      if (data?.newEmails === 0) return data;

      // New emails — fetch only what arrived since our newest known email
      const latestKnown = state.emails?.[0]?.received_at || state.emails?.[0]?.created_at;
      if (latestKnown) {
        const { data: newRows } = await sb
          .from('emails')
          .select('*')
          .gt('received_at', latestKnown)
          .order('received_at', { ascending: false })
          .limit(50);

        if (newRows?.length > 0) {
          dispatch({
            type: 'SET_EMAILS',
            payload: [...newRows.map(normalizeEmail), ...(state.emails || [])],
          });
          // Extract facts from new project-linked emails (fire and forget)
          newRows.forEach(email => {
            if (email.project_id && (email.body || email.body_preview)) {
              fetch('/api/extract-email-memory', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  project_id: email.project_id,
                  email_id: email.id,
                  subject: email.subject,
                  body: email.body || email.body_preview || '',
                  direction: 'received',
                  from_address: email.from_address || email.from_email || '',
                  to_address: email.to_address || '',
                  received_at: email.received_at || email.created_at,
                }),
              }).catch(() => {});
            }
          });

          // Deduped: extraction handled by the forEach above
          // Inherit project_id from thread — if any email in same thread is linked, link all
          const unlinkedWithThread = newRows.filter(r => !r.project_id && r.thread_id);
          if (unlinkedWithThread.length) {
            for (const row of unlinkedWithThread) {
              const { data: linked } = await sb
                .from('emails')
                .select('project_id')
                .eq('thread_id', row.thread_id)
                .not('project_id', 'is', null)
                .limit(1)
                .single();
              if (linked?.project_id) {
                await sb.from('emails')
                  .update({ project_id: linked.project_id })
                  .eq('id', row.id);
                row.project_id = linked.project_id;
              }
            }
          }

          // Trigger auto-linking on new emails
          sb.functions.invoke('auto-link-emails', { body: {} }).catch(() => {});
        }
        return data;
      }

      // Auto-link emails to projects after sync
      sb.functions.invoke('auto-link-emails', { body: {} }).catch(() => {});

      await loadEmails({ force: true });
      return data;
    } catch (err) {
      console.error('[useEmails] sync failed:', err);
      throw err;
    }
  }, [state.currentUser, state.emails, loadEmails, dispatch]);

  const markRead = useCallback(async (emailId) => {
    dispatch({
      type: 'UPDATE_EMAIL',
      payload: { id: emailId, external_id: emailId, read: true, is_read: true },
    });
    if (sb) {
      await sb.from('emails').update({ is_read: true }).eq('external_id', emailId).catch(() => {});
    }
  }, [dispatch]);

  const markReplied = useCallback(async (emailId) => {
    const repliedAt = new Date().toISOString();
    dispatch({
      type: 'UPDATE_EMAIL',
      payload: { external_id: emailId, is_replied: true, replied_at: repliedAt },
    });
    if (sb) {
      await sb.from('emails').update({ is_replied: true, replied_at: repliedAt })
        .eq('external_id', emailId).catch(() => {});
    }
  }, [dispatch]);

  const deleteEmail = useCallback(async (emailId) => {
    if (!sb) return;
    try {
      await sb.from('emails').delete().eq('id', emailId);
      dispatch({
        type: 'SET_EMAILS',
        payload: state.emails.filter(e => e.id !== emailId),
      });
    } catch (err) {
      console.error('[useEmails] delete failed:', err);
    }
  }, [dispatch, state.emails]);

  const sendEmail = useCallback(async ({ to, cc, subject, body, attachments = [], userId, projectId }) => {
    if (!sb) throw new Error('Supabase client is not available.');

    const normalisedAttachments = (attachments || []).map((attachment) => {
      const rawData = attachment.base64 || attachment.data || attachment.content || '';
      const contentBytes = String(rawData).includes(',')
        ? String(rawData).split(',').pop()
        : String(rawData);

      return {
        name: attachment.name || attachment.filename || 'attachment',
        type: attachment.type || attachment.content_type || attachment.mime_type || 'application/octet-stream',
        size: attachment.size || attachment.size_bytes || null,
        base64: contentBytes,
      };
    }).filter(att => att.base64 && att.name);

    // Normalise to comma + space separated, in case multiple addresses were
    // pasted with semicolons, newlines, or no spacing.
    const normaliseRecipients = (val) =>
      String(val || '')
        .split(/[;,\n]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .join(', ');

    const { data, error } = await sb.functions.invoke('send_email_via_microsoft', {
      body: {
        to_email: normaliseRecipients(to),
        cc_email: cc ? normaliseRecipients(cc) : null,
        subject: subject || '(No subject)',
        body,
        user_id: userId || state.currentUser?.email || state.currentUser?.id || null,
        attachments: normalisedAttachments,
      },
    });

    if (error || data?.error) {
      const message = error?.message || data?.error || 'Email send failed';
      throw new Error(message);
    }

    // Save sent email row to Supabase so to_emails and project_id are recorded
    let savedEmailId = null;
    if (sb) {
      const toList = String(to || '').split(/[;,\n]/).map(s => s.trim()).filter(Boolean);
      const ccList = cc ? String(cc).split(/[;,\n]/).map(s => s.trim()).filter(Boolean) : [];
      const sentAt = new Date().toISOString();
      const { data: inserted } = await sb.from('emails').insert({
        subject: subject || '(No subject)',
        body,
        body_preview: (body || '').slice(0, 300),
        sender_name: 'Square One Consulting',
        sender_email: 'help@sq1consulting.co.uk',
        to_emails: toList.map(e => ({ name: e, email: e })),
        cc_emails: ccList.map(e => ({ name: e, email: e })),
        sent_at: sentAt,
        received_at: sentAt,
        folder: 'Sent',
        is_read: true,
        project_id: projectId || null,
        user_id: state.currentUser?.id || null,
      }).select('id').maybeSingle();
      savedEmailId = inserted?.data?.id || null;
    }

    // Extract key facts into project memory in the background (fire and forget)
    if (projectId) {
      fetch('/api/extract-email-memory', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          project_id: projectId,
          email_id: savedEmailId,
          subject,
          body,
          direction: 'sent',
          to_address: to,
          received_at: new Date().toISOString(),
        }),
      }).catch(() => {});
    }

    await loadEmails({ force: true }).catch(() => {});
    return data || { ok: true };
  }, [loadEmails, state.currentUser]);

  // ── Auto-sync every 5 minutes ────────────────────────────────────────────
  const syncIntervalRef = useRef(null);

  useEffect(() => {
    // Start auto-sync after initial load
    syncIntervalRef.current = setInterval(async () => {
      try {
        await syncOutlook();
      } catch {
        // Silent — never interrupt the user
      }
    }, 5 * 60 * 1000); // every 5 minutes

    return () => {
      if (syncIntervalRef.current) clearInterval(syncIntervalRef.current);
    };
  }, [syncOutlook]);

  return {
    emails: state.emails,
    loading,
    loadEmails,
    syncOutlook,
    ensureTokenFresh,
    markRead,
    markReplied,
    deleteEmail,
    sendEmail,
  };
}

function normalizeEmail(row) {
  const t = new Date(row.received_at || row.sent_at || row.created_at || 0).getTime();
  return {
    ...row,
    id: row.id,
    external_id: row.external_id || row.id,
    from: row.sender_name || row.from_email || row.sender_email || 'Unknown',
    from_email: row.from_email || row.sender_email || '',
    subject: row.subject || '(No subject)',
    preview: row.body_preview || row.preview || '',
    body: row.body || '',
    read: row.is_read || false,
    unread: !row.is_read,
    time: formatEmailTime(row.received_at || row.sent_at || row.created_at),
    _t: t,
    attachments: row.email_attachments || row.attachments || [],
    flagged: isUrgentEmail(row),
    channel: row.channel || 'email',
    project_id: row.project_id || null,
  };
}

function formatEmailTime(date) {
  if (!date) return '';
  const d = new Date(date);
  const now = new Date();
  const diffMs = now - d;
  const diffDays = Math.floor(diffMs / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  } else if (diffDays === 1) {
    return 'Yesterday';
  } else if (diffDays < 7) {
    return d.toLocaleDateString('en-GB', { weekday: 'short' });
  } else {
    return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
}

function isUrgentEmail(e) {
  const s = (e.subject || '').toLowerCase();
  const b = (e.body_preview || e.preview || '').toLowerCase();
  return (
    s.includes('urgent') || s.includes('damage') || s.includes('emergency') ||
    b.includes('structural damage') || b.includes('urgent')
  );
}



