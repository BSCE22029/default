import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';

const STEPS = [
  { ico: '🏢', title: 'Your workspace', desc: 'Invite your team and manage leads together' },
  { ico: '🔒', title: 'Fully private',   desc: 'Row-level security — your data is yours only' },
  { ico: '🚀', title: 'Up in minutes',   desc: 'Import leads, run campaigns, track results today' },
];

export default function Signup() {
  const { signUp, signInWithGoogle } = useAuth();
  const nav = useNavigate();
  const [form, setForm] = useState({ fullName:'', orgName:'', email:'', password:'' });
  const [err,  setErr]  = useState('');
  const [msg,  setMsg]  = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  async function submit(e) {
    e.preventDefault();
    setErr(''); setMsg(''); setBusy(true);
    const { data, error } = await signUp(form.email, form.password, form.orgName, form.fullName);
    setBusy(false);
    if (error) return setErr(error.message);
    if (data.session) nav('/');
    else setMsg('Account created! Check your email to confirm, then sign in.');
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
            Your CRM,<br />ready in minutes.
          </h2>
          <p style={{ color:'rgba(255,255,255,.65)', fontSize:15, lineHeight:1.75, marginBottom:44 }}>
            Join teams using LeadFlow to find leads,<br />send emails, and close faster.
          </p>
          <div style={{ display:'flex', flexDirection:'column', gap:24 }}>
            {STEPS.map((s) => (
              <div key={s.title} style={{ display:'flex', gap:16, alignItems:'flex-start' }}>
                <div style={{ width:40, height:40, borderRadius:12, background:'rgba(255,255,255,.12)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:20, flexShrink:0 }}>
                  {s.ico}
                </div>
                <div>
                  <div style={{ color:'#fff', fontWeight:700, fontSize:14, marginBottom:3 }}>{s.title}</div>
                  <div style={{ color:'rgba(255,255,255,.55)', fontSize:12.5, lineHeight:1.6 }}>{s.desc}</div>
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
          <h1 style={{ fontSize:24, fontWeight:800, marginBottom:6 }}>Create your workspace</h1>
          <p className="sub" style={{ marginBottom:28 }}>Start managing leads in minutes — free forever</p>

          {err && <div className="alert alert-error">{err}</div>}
          {msg && <div className="alert alert-ok">{msg}</div>}

          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0 12px' }}>
            <div className="field">
              <label>Your name</label>
              <input value={form.fullName} onChange={set('fullName')} required autoFocus placeholder="Moiz Ahmad" />
            </div>
            <div className="field">
              <label>Workspace name</label>
              <input value={form.orgName} onChange={set('orgName')} placeholder="Atronm" required />
            </div>
          </div>
          <div className="field">
            <label>Work email</label>
            <input type="email" value={form.email} onChange={set('email')} required placeholder="you@company.com" />
          </div>
          <div className="field" style={{ marginBottom:22 }}>
            <label>Password <span style={{ fontWeight:400, color:'var(--muted)', fontSize:11 }}>(min. 6 chars)</span></label>
            <input type="password" value={form.password} onChange={set('password')} minLength={6} required placeholder="••••••••" />
          </div>

          <button className="btn btn-primary btn-block" disabled={busy}
            style={{ height:46, fontSize:15, borderRadius:12 }}>
            {busy ? '⏳ Creating workspace…' : 'Create workspace →'}
          </button>

          <div className="auth-divider"><span>or</span></div>

          <button type="button" className="btn-google" onClick={signInWithGoogle}>
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.874 2.684-6.615z" fill="#4285F4"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.184l-2.908-2.258c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#34A853"/>
              <path d="M3.964 10.707A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.707V4.961H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.039l3.007-2.332z" fill="#FBBC05"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.961L3.964 7.293C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
            </svg>
            Sign up with Google
          </button>

          <p className="sub" style={{ marginTop:20, marginBottom:0, textAlign:'center' }}>
            Already have an account? <Link className="muted-link" to="/login">Sign in</Link>
          </p>
        </form>
      </div>
    </div>
  );
}
