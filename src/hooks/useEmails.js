import { useState, useCallback } from 'react';
import { useApp } from '../state/appStore';
import sb from '../supabaseClient';

export function useEmails() {
  const { state, dispatch } = useApp();
  const [loading, setLoading] = useState(false);

  const loadEmails = useCallback(async () => {
    if (!sb) return;
    setLoading(true);
    try {
      let res = await sb
        .from('emails')
        .select('*, email_attachments(*)')
        .order('created_at', { ascending: false })
        .limit(200);

      if (res.error) {
        res = await sb
          .from('emails')
          .select('*')
          .order('created_at', { ascending: false })
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
  }, [dispatch]);

  const syncOutlook = useCallback(async () => {
    if (!sb) return;
    try {
      const { data, error } = await sb.functions.invoke('sync_outlook', {
        body: { user_id: state.currentUser?.email || state.currentUser?.id },
      });
      if (error) throw error;
      await loadEmails();
      return data;
    } catch (err) {
      console.error('[useEmails] sync failed:', err);
      throw err;
    }
  }, [state.currentUser, loadEmails]);

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

  const sendEmail = useCallback(async ({ to, subject, body, attachments = [], userId }) => {
    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, subject, body, user_id: userId, attachments }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) {
      throw new Error(data.error || 'Email send failed');
    }
    return data;
  }, []);

  return {
    emails: state.emails,
    loading,
    loadEmails,
    syncOutlook,
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
    from: row.sender_name || row.from_email || 'Unknown',
    from_email: row.from_email || '',
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
