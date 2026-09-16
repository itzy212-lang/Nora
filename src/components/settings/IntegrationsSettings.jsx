import { useEffect, useState } from 'react';
import sb from '../../supabaseClient';

export default function IntegrationsSettings() {
  const [integrations, setIntegrations] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    loadIntegrations();

    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'google' && params.get('status') === 'success') {
      const timer = setTimeout(() => {
        loadIntegrations();
        window.history.replaceState({}, document.title, window.location.pathname);
      }, 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const loadIntegrations = async () => {
    try {
      const { data: { user } } = await sb.auth.getUser();
      if (!user) return;

      const { data } = await sb
        .from('user_integrations')
        .select('*')
        .eq('user_id', user.id)
        .single();

      if (data) {
        setIntegrations(data);
      } else {
        // Create new row if doesn't exist
        const { data: newRow } = await sb
          .from('user_integrations')
          .insert([{ user_id: user.id }])
          .select()
          .single();
        setIntegrations(newRow);
      }
    } catch (err) {
      console.error('Error loading integrations:', err.message);
    } finally {
      setLoading(false);
    }
  };

  const updateProvider = async (field, value) => {
    setSaving(true);
    try {
      const { error } = await sb
        .from('user_integrations')
        .update({ [field]: value })
        .eq('id', integrations.id);

      if (error) throw error;

      setIntegrations(prev => ({ ...prev, [field]: value }));
    } catch (err) {
      console.error('Error updating provider:', err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleGmailConnect = () => {
    const clientId = import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID;
    if (!clientId) {
      alert('VITE_GOOGLE_OAUTH_CLIENT_ID is not set in this build. Check Vercel env vars are set for Production and redeploy.');
      return;
    }
    const callbackUri = `${window.location.origin}/api/google-callback`;

    const googleAuthUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    googleAuthUrl.searchParams.append('client_id', clientId);
    googleAuthUrl.searchParams.append('redirect_uri', callbackUri);
    googleAuthUrl.searchParams.append('response_type', 'code');
    googleAuthUrl.searchParams.append('scope', 'openid email https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/drive.file');
    googleAuthUrl.searchParams.append('access_type', 'offline');
    googleAuthUrl.searchParams.append('prompt', 'consent');

    window.location.href = googleAuthUrl.toString();
  };

  const handleGmailDisconnect = async () => {
    await updateProvider('gmail_access_token', null);
    await updateProvider('gmail_refresh_token', null);
  };

  const handleGoogleDriveConnect = () => {
    // Same as Gmail — combined OAuth flow
    handleGmailConnect();
  };

  const handleGoogleDriveDisconnect = async () => {
    await updateProvider('google_drive_access_token', null);
    await updateProvider('google_drive_refresh_token', null);
  };

  if (loading) return <div style={{ padding: 20 }}>Loading integrations...</div>;
  if (!integrations) return <div style={{ padding: 20 }}>Error loading integrations.</div>;

  return (
    <div style={{ padding: 20 }}>
      <h2>Email & Storage Integrations</h2>

      {/* Email Provider */}
      <div style={{ marginBottom: 30, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
        <h3>Email Provider</h3>
        <p style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 15 }}>
          Choose where your emails sync from. You can switch at any time.
        </p>

        <div style={{ display: 'flex', gap: 15, marginBottom: 15 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="email_provider"
              value="outlook"
              checked={integrations.email_provider === 'outlook'}
              onChange={() => updateProvider('email_provider', 'outlook')}
              disabled={saving}
            />
            <span>Outlook / Microsoft 365</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="email_provider"
              value="gmail"
              checked={integrations.email_provider === 'gmail'}
              onChange={() => updateProvider('email_provider', 'gmail')}
              disabled={saving}
            />
            <span>Gmail</span>
          </label>
        </div>

        {integrations.email_provider === 'gmail' && (
          <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 8, marginBottom: 15 }}>
            {integrations.gmail_access_token ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>✅ Gmail connected</span>
                <button
                  onClick={handleGmailDisconnect}
                  disabled={saving}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#f5f5f5',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleGmailConnect}
                disabled={saving}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  background: '#1f2937',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Connect Gmail
              </button>
            )}
          </div>
        )}
      </div>

      {/* Storage Provider */}
      <div style={{ marginBottom: 30 }}>
        <h3>Storage Provider</h3>
        <p style={{ color: 'var(--text3)', fontSize: 13, marginBottom: 15 }}>
          Choose where project files are stored. You can switch at any time.
        </p>

        <div style={{ display: 'flex', gap: 15, marginBottom: 15 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="storage_provider"
              value="onedrive"
              checked={integrations.storage_provider === 'onedrive'}
              onChange={() => updateProvider('storage_provider', 'onedrive')}
              disabled={saving}
            />
            <span>OneDrive / Microsoft 365</span>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <input
              type="radio"
              name="storage_provider"
              value="googledrive"
              checked={integrations.storage_provider === 'googledrive'}
              onChange={() => updateProvider('storage_provider', 'googledrive')}
              disabled={saving}
            />
            <span>Google Drive</span>
          </label>
        </div>

        {integrations.storage_provider === 'googledrive' && (
          <div style={{ padding: 12, background: 'var(--bg3)', borderRadius: 8 }}>
            {integrations.google_drive_access_token ? (
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text2)' }}>✅ Google Drive connected</span>
                <button
                  onClick={handleGoogleDriveDisconnect}
                  disabled={saving}
                  style={{
                    padding: '6px 12px',
                    fontSize: 12,
                    background: '#f5f5f5',
                    border: '1px solid #ddd',
                    borderRadius: 4,
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  Disconnect
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleDriveConnect}
                disabled={saving}
                style={{
                  padding: '8px 16px',
                  fontSize: 13,
                  background: '#1f2937',
                  color: 'white',
                  border: 'none',
                  borderRadius: 4,
                  cursor: saving ? 'not-allowed' : 'pointer',
                }}
              >
                Connect Google Drive
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
