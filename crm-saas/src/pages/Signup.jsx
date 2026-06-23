import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function Signup() {
  const { signUp } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ fullName: '', orgName: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    const { data, error } = await signUp(form.email, form.password, form.orgName, form.fullName);
    setBusy(false);
    if (error) return setErr(error.message);
    // If email confirmation is OFF, a session is returned immediately.
    if (data.session) { nav('/'); }
    else setMsg('Account created! Check your email to confirm, then sign in.');
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="dot" /> LeadFlow</div>
        <h1>Create your workspace</h1>
        <p className="sub">Start managing leads in minutes</p>
        {err && <div className="alert alert-error">{err}</div>}
        {msg && <div className="alert alert-ok">{msg}</div>}
        <div className="field">
          <label>Your name</label>
          <input value={form.fullName} onChange={set('fullName')} required autoFocus />
        </div>
        <div className="field">
          <label>Company / workspace name</label>
          <input value={form.orgName} onChange={set('orgName')} placeholder="Acme Inc." required />
        </div>
        <div className="field">
          <label>Work email</label>
          <input type="email" value={form.email} onChange={set('email')} required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={form.password} onChange={set('password')} minLength={6} required />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Creating…' : 'Create workspace'}</button>
        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
          Already have an account? <Link className="muted-link" to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  );
}
