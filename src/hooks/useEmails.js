import { useState, useCallback } from 'react';
import { useApp } from '../state/appStore';
import sb from '../supabaseClient';
import { saveCachedEmails } from '../utils/emailCache';

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
        .limit(300);

      if (res.error) {
        res = await sb
          .from('emails')
          .select('*')
          .order('received_at', { ascending: false })
          .limit(300);
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

  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMoreEmails, setHasMoreEmails] = useState(true);

  // Added 2026-08-13, on request: real "load more" for infinite scroll.
  // Fetches the next 300 emails older than whatever's currently the
  // oldest loaded email, and appends them — this is the actual
  // mechanism that lets scrolling reach real history instead of hard-
  // stopping at the first 300 loaded on open. Never re-fetches anything
  // already loaded; never loads thousands at once.
  const loadMoreEmails = useCallback(async () => {
    if (!sb || loadingMore || !hasMoreEmails) return;
    const currentEmails = state.emails || [];
    if (!currentEmails.length) return;

    const oldestLoaded = currentEmails.reduce((oldest, e) => {
      const t = new Date(e.received_at || e.sent_at || 0).getTime();
      return t < oldest ? t : oldest;
    }, Date.now());

    setLoadingMore(true);
    try {
      const { data, error } = await sb
        .from('emails')
        .select('*')
        .lt('received_at', new Date(oldestLoaded).toISOString())
        .order('received_at', { ascending: false })
        .limit(300);

      if (error) throw error;

      const rows = (data || []).map(normalizeEmail);
      if (rows.length < 300) setHasMoreEmails(false);
      if (rows.length) {
        dispatch({ type: 'APPEND_EMAILS', payload: rows });
        saveCachedEmails(rows); // added 2026-08-14 — persist scrolled-back history too
      }
      return rows;
    } catch (err) {
      console.error('[useEmails] loadMore failed:', err);
      return [];
    } finally {
      setLoadingMore(false);
    }
  }, [dispatch, state.emails, loadingMore, hasMoreEmails]);

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
          const { data: { session: authSession3 } } = await sb.auth.getSession();
          newRows.forEach(email => {
            // Embed every new email (fire and forget) — enables semantic search
            fetch('/api/embed', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'embed_record', record_id: email.id, table: 'emails' }),
            }).catch(() => {});
            // Extract facts into project memory if linked to a project
            if (email.project_id && (email.body || email.body_preview)) {
              fetch('/api/extract-email-memory', {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                  ...(authSession3?.access_token ? { 'Authorization': `Bearer ${authSession3.access_token}` } : {}),
                },
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

          // Fixed 2026-08-14: removed the old local-only notification
          // that lived here — it only ever fired while this code was
          // actively running, which requires the app to already be
          // open, exactly the gap reported. Replaced with a real
          // database trigger (send_push_on_new_email) that fires the
          // moment a new email is inserted, server-side, regardless of
          // whether the app is open at all. Keeping both would have
          // caused duplicate notifications whenever the app happened
          // to be open at the same moment.
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
    let insertedRow = null;
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
        // Fixed 2026-08-22, real, confirmed bug: this insert never
        // set is_sent or direction, so the database trigger that
        // fires a push notification on new mail (checking exactly
        // these two fields) couldn't tell this apart from a genuine
        // incoming email — explains being notified for your own sent
        // emails. The other, separate send path (Inbox.jsx's own
        // reply handler) already set is_sent correctly; this one
        // didn't.
        is_sent: true,
        direction: 'outgoing',
        is_read: true,
        project_id: projectId || null,
        user_id: state.currentUser?.id || null,
      }).select('*').maybeSingle();
      savedEmailId = inserted?.id || null;
      insertedRow = inserted || null;
    }

    // Extract key facts into project memory in the background (fire and forget)
    if (projectId) {
      const { data: { session: authSession4 } } = await sb.auth.getSession();
      fetch('/api/extract-email-memory', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(authSession4?.access_token ? { 'Authorization': `Bearer ${authSession4.access_token}` } : {}),
        },
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

    // Fixed 2026-08-17, on request: this used to call loadEmails({
    // force: true }) — this hook's own blunt 'fetch 300 most recent,
    // replace everything' function, completely bypassing Inbox.jsx's
    // proper cache-aware system. A narrower race than the 5-minute
    // interval removed above (only if the inbox happened to be
    // loading at the exact moment an email was sent), but the same
    // underlying flaw. Appends just the one email that was actually
    // sent instead — safe regardless of what else is loading.
    if (insertedRow) {
      dispatch({ type: 'APPEND_EMAILS', payload: [normalizeEmail(insertedRow)] });
    }
    return data || { ok: true };
  }, [state.currentUser]);

  // Fixed 2026-08-17, on request: real, confirmed second instance of
  // the same class of bug fixed earlier today (two independent
  // systems writing to shared inbox state, racing each other). This
  // auto-sync interval ran completely independently of Inbox.jsx's
  // own, proper cache-aware sync (which already runs its own 3-minute
  // auto-sync) — every 5 minutes it could replace the whole emails
  // array based on its own snapshot, bypassing the local cache
  // entirely (it never called saveCachedEmails), so the on-device
  // cache and what was briefly shown could genuinely diverge. That
  // matches exactly what was reported: emails flickering between
  // current, stale July content, and briefly empty. Inbox.jsx already
  // owns this responsibility correctly — this duplicate is removed
  // entirely rather than patched. syncIntervalRef was only ever used
  // here, no longer needed.

  return {
    emails: state.emails,
    loading,
    loadEmails,
    loadMoreEmails,
    loadingMore,
    hasMoreEmails,
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



