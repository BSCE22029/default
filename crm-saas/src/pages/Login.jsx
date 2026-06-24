import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

const FEATURES = [
  { ico: '⚡', title: 'AI-Powered Lead Gen', desc: 'Pull real businesses from 20+ countries in seconds using live map data' },
  { ico: '✍️', title: 'One-Click Outreach',  desc: 'Auto-drafted, personalized emails with 4 pitch angles — send in one click' },
  { ico: '📊', title: 'Visual Pipeline',     desc: 'Drag-and-drop kanban, conversion funnel, and email reply tracking' },
];

export default function Login() {
  const { signIn } = useAuth();
  const nav = useNavigate();
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [err,      setErr]      = useState('');
  const [busy,     setBusy]     = useState(false);

  async function submit(e) {
    e.preventDefault();
    setErr(''); setBusy(true);
    const { error } = await signIn(email, password);
    setBusy(false);
    if (error) return setErr(error.message);
    nav('/');
  }

  return (
    <div className="auth-split">
      {/* Left branding panel */}
      <div className="auth-panel">
        <div className="auth-panel-inner">
          <div className="brand" style={{ color:'#fff', marginBottom:44 }}>
            <span className="dot" /> LeadFlow
          </div>
          <h2 style={{ color:'#fff', fontSize:30, fontWeight:800, lineHeight:1.25, marginBottom:14 }}>
            Close more deals.<br />Automate your outreach.
          </h2>
          <p style={{ color:'rgba(255,255,255,.65)', fontSize:15, lineHeight:1.75, marginBottom:44 }}>
            The all-in-one CRM built for solo founders<br />and lean sales teams.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
            {FEATURES.map((f) => (
              <div key={f.title} style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
                <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
                  {f.ico}
                </div>
                <div>
                  <div style={{ color:'#fff', fontWeight:700, fontSize:14, marginBottom:3 }}>{f.title}</div>
                  <div style={{ color:'rgba(255,255,255,.55)', fontSize:12.5, lineHeight:1.6 }}>{f.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right form panel */}
      <div className="auth-form-panel">
        <form className="auth-card" onSubmit={submit}>
          <div className="brand" style={{ marginBottom:28 }}><span className="dot" /> LeadFlow</div>
          <h1 style={{ fontSize:24, fontWeight:800, marginBottom:6 }}>Welcome back</h1>
          <p className="sub" style={{ marginBottom:28 }}>Sign in to your CRM workspace</p>

          {err && <div className="alert alert-error">{err}</div>}

          <div className="field">
            <label>Email address</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              required autoFocus placeholder="you@company.com" />
          </div>
          <div className="field" style={{ marginBottom:22 }}>
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)}
              required placeholder="••••••••" />
          </div>

          <button className="btn btn-primary btn-block" disabled={busy}
            style={{ height:46, fontSize:15, borderRadius:12 }}>
            {busy ? '⏳ Signing in…' : 'Sign in →'}
          </button>

          <p className="sub" style={{ marginTop:22, marginBottom:0, textAlign:'center' }}>
            No account? <Link className="muted-link" to="/signup">Create a workspace</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
