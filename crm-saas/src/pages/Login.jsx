import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

export default function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) return setErr(error.message);
    nav('/');
  }

  return (
    <div className="auth-wrap">
      <form className="auth-card" onSubmit={submit}>
        <div className="brand"><span className="dot" /> LeadFlow</div>
        <h1>Welcome back</h1>
        <p className="sub">Sign in to your CRM workspace</p>
        {err && <div className="alert alert-error">{err}</div>}
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        <p className="sub" style={{ marginTop: 16, marginBottom: 0, textAlign: 'center' }}>
          No account? <Link className="muted-link" to="/signup">Create a workspace</Link>
        </p>
      </form>
    </div>
  );
}
