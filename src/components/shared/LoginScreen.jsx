import { useState } from 'react';
import sb from '../../supabaseClient';

export default function LoginScreen({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [mode, setMode] = useState('login'); // 'login' | 'signup' | 'reset'
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || (!password && mode !== 'reset')) return;
    setLoading(true);
    setError('');
    setMessage('');
    try {
      if (mode === 'login') {
        const { data, error } = await sb.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onLogin(data.user);
      } else if (mode === 'signup') {
        const { data, error } = await sb.auth.signUp({ email, password });
        if (error) throw error;
        setMessage('Check your email for a confirmation link.');
      } else if (mode === 'reset') {
        const { error } = await sb.auth.resetPasswordForEmail(email);
        if (error) throw error;
        setMessage('Password reset email sent.');
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg)', display: 'flex',
      alignItems: 'center', justifyContent: 'center', padding: 20,
    }}>
      <div style={{
        background: 'var(--bg2)', border: '1px solid var(--border)', borderRadius: 'var(--rxl)',
        padding: 32, width: '100%', maxWidth: 420, boxShadow: '0 20px 60px rgba(0,0,0,0.3)',
      }}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
          <div style={{ width: 40, height: 40, borderRadius: 10, background: 'var(--blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 20, fontWeight: 700, color: '#fff' }}>
            E
          </div>
          <div>
            <div style={{ fontSize: 18, fontWeight: 700 }}>Ely</div>
            <div style={{ fontSize: 11, color: 'var(--text3)' }}>Practice Assistant</div>
          </div>
        </div>

        <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 6 }}>
          {mode === 'login' ? 'Sign in' : mode === 'signup' ? 'Create account' : 'Reset password'}
        </h2>
        <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 20 }}>
          {mode === 'login' ? 'Welcome back to your practice assistant.' : mode === 'signup' ? 'Get started with party wall management.' : 'Enter your email to reset your password.'}
        </p>

        {error && (
          <div style={{ background: 'var(--red-bg)', border: '1px solid var(--red)', color: 'var(--red)', borderRadius: 'var(--r)', padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
            {error}
          </div>
        )}
        {message && (
          <div style={{ background: 'var(--green-bg)', border: '1px solid var(--green)', color: 'var(--green)', borderRadius: 'var(--r)', padding: '10px 12px', fontSize: 12.5, marginBottom: 14 }}>
            {message}
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="form-row">
            <label className="form-label">Email</label>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" required />
          </div>
          {mode !== 'reset' && (
            <div className="form-row">
              <label className="form-label">Password</label>
              <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="••••••••" required />
            </div>
          )}
          <button type="submit" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '11px', fontSize: 13.5, marginTop: 8 }} disabled={loading}>
            {loading ? 'Please wait…' : mode === 'login' ? 'Sign in →' : mode === 'signup' ? 'Create account →' : 'Send reset email'}
          </button>
        </form>

        <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {mode === 'login' && (
            <>
              <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }} onClick={() => setMode('signup')}>
                Don't have an account? Sign up
              </button>
              <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }} onClick={() => setMode('reset')}>
                Forgot password?
              </button>
            </>
          )}
          {mode !== 'login' && (
            <button className="btn btn-ghost btn-sm" style={{ justifyContent: 'center' }} onClick={() => setMode('login')}>
              ← Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
