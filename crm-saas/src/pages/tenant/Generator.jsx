import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page, { CoAvatar } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { guessEmails } from '../../lib/emailGuess';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON     = import.meta.env.VITE_SUPABASE_ANON_KEY;

const STEPS = ['Connecting to data source…', 'Scanning businesses…', 'Scoring leads…', 'Finalising results…'];

export default function Generator() {
  const { orgId } = useAuth();
  const [keyword,  setKeyword]  = useState('');
  const [location, setLocation] = useState('');
  const [limit,    setLimit]    = useState(12);
  const [busy,     setBusy]     = useState(false);
  const [step,     setStep]     = useState(0);
  const [pct,      setPct]      = useState(0);
  const [results,  setResults]  = useState([]);
  const [source,   setSource]   = useState('');
  const [msg,      setMsg]      = useState('');
  const [existing, setExisting] = useState(new Set());
  const [added,    setAdded]    = useState(new Set());

  const [auto,       setAuto]       = useState({ enabled: false, keyword: '', location: '', daily_limit: 10 });
  const [autoMsg,    setAutoMsg]    = useState('');
  const [emailMap,   setEmailMap]   = useState({}); // company.lower → chosen email
  const [showSugg,   setShowSugg]   = useState(''); // company.lower showing suggestions

  async function loadOrg() {
    const [{ data: org }, { data: leads }] = await Promise.all([
      supabase.from('app_orgs').select('autogen').eq('id', orgId).maybeSingle(),
      supabase.from('app_leads').select('company'),
    ]);
    if (org?.autogen) setAuto({ enabled: false, keyword: '', location: '', daily_limit: 10, ...org.autogen });
    setExisting(new Set((leads || []).map((l) => (l.company || '').toLowerCase())));
  }
  useEffect(() => { if (orgId) loadOrg(); }, [orgId]);

  async function generate() {
    setBusy(true); setMsg(''); setResults([]); setAdded(new Set()); setStep(0); setPct(0); setEmailMap({}); setShowSugg('');
    // Animated progress
    let s = 0, p = 0;
    const tick = setInterval(() => {
      p = Math.min(p + Math.random() * 14, 88);
      s = Math.min(Math.floor(p / 25), STEPS.length - 1);
      setPct(Math.floor(p)); setStep(s);
    }, 420);
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/generate-leads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
        body: JSON.stringify({ keyword, location, limit: Number(limit) }),
      });
      const data = await res.json();
      clearInterval(tick); setPct(100); setStep(STEPS.length - 1);
      if (!data.success) throw new Error(data.error || 'Generation failed');
      setResults(data.leads || []); setSource(data.source);
      if (!data.leads?.length) setMsg('No businesses found — try a broader keyword or a different city.');
    } catch (e) { clearInterval(tick); setPct(0); setMsg('Error: ' + e.message); }
    setBusy(false);
  }

  function resolvedEmail(l) {
    return emailMap[l.company.toLowerCase()] || l.email || '';
  }

  async function addOne(l) {
    await supabase.from('app_leads').insert({
      org_id: orgId, company: l.company, website: l.website || '', email: resolvedEmail(l),
      industry: l.industry || '', country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead',
      notes: 'Generated from ' + (location || 'web'),
    });
    setExisting((s) => new Set(s).add(l.company.toLowerCase()));
    setAdded((s) => new Set(s).add(l.company.toLowerCase()));
  }

  async function addAll() {
    const fresh = results.filter((l) => !existing.has(l.company.toLowerCase()));
    if (!fresh.length) { setMsg('All generated leads are already in your CRM.'); return; }
    await supabase.from('app_leads').insert(fresh.map((l) => ({
      org_id: orgId, company: l.company, website: l.website || '', email: resolvedEmail(l),
      industry: l.industry || '', country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead',
      notes: 'Generated from ' + (location || 'web'),
    })));
    const names = new Set(fresh.map((l) => l.company.toLowerCase()));
    setExisting((s) => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
    setAdded((s) => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
    setMsg(`✅ Added ${fresh.length} leads to your CRM.`);
  }

  async function saveAuto(next) {
    setAuto(next);
    await supabase.from('app_orgs').update({ autogen: next }).eq('id', orgId);
    setAutoMsg('Saved ✓'); setTimeout(() => setAutoMsg(''), 1800);
  }

  async function runAutoNow() {
    setAutoMsg('Running…');
    const { data: { session } } = await supabase.auth.getSession();
    const res  = await fetch(`${SUPA_URL}/functions/v1/autogen-run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
    const data = await res.json();
    const cnt  = (data.summary || []).reduce((s, x) => s + (x.added || 0), 0);
    setAutoMsg(data.success ? `✅ Added ${cnt} new leads` : ('Error: ' + (data.error || 'failed')));
    loadOrg();
  }

  const newCount = results.filter((l) => !existing.has(l.company.toLowerCase())).length;

  return (
    <Page title="Lead Generator">
      {/* Manual generation */}
      <div className="card" style={{ marginBottom:18 }}>
        <div className="card-head">
          <h3>⚡ Generate leads from the web</h3>
          {source && <span style={{ fontSize:12, color:'var(--muted)' }}>source: {source}</span>}
        </div>
        <div className="card-body">
          <p style={{ color:'var(--muted)', fontSize:13, marginBottom:16 }}>
            Pulls real businesses from public OpenStreetMap data. Enter a city and optional keyword — results are scored and ready to add in one click.
          </p>
          <div className="toolbar" style={{ marginBottom:0 }}>
            <input placeholder="Keyword (e.g. software, agency, consulting)"
              value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ minWidth:240 }}
              onKeyDown={(e) => e.key === 'Enter' && location && !busy && generate()} />
            <input placeholder="City (e.g. London, UK)"
              value={location} onChange={(e) => setLocation(e.target.value)} style={{ minWidth:180 }}
              onKeyDown={(e) => e.key === 'Enter' && location && !busy && generate()} />
            <input type="number" min="1" max="30" value={limit}
              onChange={(e) => setLimit(e.target.value)} style={{ width:76 }} title="Max results" />
            <button className="btn btn-primary" disabled={busy || !location} onClick={generate} style={{ minWidth:130 }}>
              {busy ? '⏳ Searching…' : '⚡ Generate'}
            </button>
            {newCount > 0 && !busy && (
              <button className="btn btn-ghost" onClick={addAll}>+ Add all {newCount} to CRM</button>
            )}
          </div>

          {/* Progress bar */}
          {busy && (
            <div style={{ marginTop:18 }}>
              <div style={{ display:'flex', justifyContent:'space-between', marginBottom:6, fontSize:12, color:'var(--muted)' }}>
                <span>{STEPS[step]}</span>
                <span>{pct}%</span>
              </div>
              <div style={{ height:6, background:'var(--border)', borderRadius:99, overflow:'hidden' }}>
                <div style={{
                  height:'100%', borderRadius:99, width:`${pct}%`,
                  background:'linear-gradient(90deg, #6366f1, #818cf8)',
                  transition:'width .35s ease',
                }} />
              </div>
            </div>
          )}

          {msg && <div className={`alert ${msg.startsWith('✅') ? 'alert-ok' : 'alert-error'}`} style={{ marginTop:14 }}>{msg}</div>}
        </div>
      </div>

      {/* Results card grid */}
      {results.length > 0 && (
        <div style={{ marginBottom:18 }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
            <div style={{ fontSize:13, color:'var(--muted)' }}>
              <b style={{ color:'var(--text)' }}>{results.length}</b> results
              {newCount > 0 && <> · <span style={{ color:'#22c55e', fontWeight:700 }}>{newCount} new</span></>}
              {results.length - newCount > 0 && <> · {results.length - newCount} already in CRM</>}
            </div>
            {newCount > 0 && (
              <button className="btn btn-primary btn-sm" onClick={addAll}>+ Add all {newCount} new</button>
            )}
          </div>
          <div className="gen-grid">
            {results.map((l, i) => {
              const inCrm    = existing.has(l.company.toLowerCase());
              const justAdded = added.has(l.company.toLowerCase());
              const domain   = (l.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
              const score    = l.lead_score || 55;
              return (
                <div key={i} className={`gen-card ${inCrm ? 'gen-card-added' : ''}`}>
                  <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:10 }}>
                    <CoAvatar company={l.company} size={36} />
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:700, fontSize:14, lineHeight:1.2 }}>{l.company}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:2 }}>{l.industry || l.category || 'Business'}</div>
                    </div>
                    <span className={`score-badge ${score >= 75 ? 'hot' : score >= 55 ? 'warm' : 'cold'}`} style={{ flexShrink:0 }}>{score}</span>
                  </div>

                  {l.website && (
                    <div style={{ fontSize:12, marginBottom:5 }}>
                      🌐 <a href={l.website.startsWith('http') ? l.website : 'https://'+l.website} target="_blank" rel="noreferrer"
                        style={{ color:'var(--primary)' }}>{domain}</a>
                    </div>
                  )}

                  {/* Email display with suggestion picker */}
                  {(() => {
                    const key      = l.company.toLowerCase();
                    const chosen   = emailMap[key];
                    const hasEmail = chosen || l.email;
                    const suggs    = guessEmails(l.website);
                    return (
                      <div style={{ marginBottom:5 }}>
                        {hasEmail ? (
                          <div style={{ fontSize:12, color:'var(--muted)', display:'flex', alignItems:'center', gap:6 }}>
                            ✉️ <span style={{ color: chosen ? '#6366f1' : undefined }}>{chosen || l.email}</span>
                            {suggs.length > 0 && (
                              <button type="button" style={{ fontSize:10, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline' }}
                                onClick={() => setShowSugg(showSugg === key ? '' : key)}>change</button>
                            )}
                          </div>
                        ) : suggs.length > 0 ? (
                          <button type="button" className="find-email-btn"
                            onClick={() => setShowSugg(showSugg === key ? '' : key)}>
                            🔍 Find email
                          </button>
                        ) : null}
                        {showSugg === key && suggs.length > 0 && (
                          <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:4 }}>
                            {suggs.map((s) => (
                              <button key={s} type="button" className="sugg-chip"
                                style={{ background: emailMap[key] === s ? '#e0e7ff' : undefined, color: emailMap[key] === s ? '#4338ca' : undefined }}
                                onClick={() => { setEmailMap((m) => ({ ...m, [key]: s })); setShowSugg(''); }}>
                                {s}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    );
                  })()}

                  {l.phone && <div style={{ fontSize:12, color:'var(--muted)', marginBottom:5 }}>📞 {l.phone}</div>}
                  {l.country && <div style={{ fontSize:11, color:'var(--muted)' }}>📍 {l.country}</div>}

                  <div style={{ marginTop:12 }}>
                    {inCrm ? (
                      <div style={{ fontSize:12, fontWeight:700, color: justAdded ? '#22c55e' : '#94a3b8' }}>
                        {justAdded ? '✅ Added to CRM' : '✓ Already in CRM'}
                      </div>
                    ) : (
                      <button className="btn btn-sm btn-primary" style={{ width:'100%' }} onClick={() => addOne(l)}>
                        + Add to CRM
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Automation */}
      <div className="card">
        <div className="card-head">
          <h3>🤖 Automated daily generation</h3>
          {autoMsg && <span style={{ fontSize:12, color:'var(--green)', fontWeight:700 }}>{autoMsg}</span>}
        </div>
        <div className="card-body">
          <label className="row" style={{ gap:10, marginBottom:16, cursor:'pointer', alignItems:'flex-start' }}>
            <input type="checkbox" checked={auto.enabled} style={{ marginTop:2 }}
              onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} />
            <span style={{ fontSize:13 }}>
              <b>Enable auto-generation</b> — every day at 08:00 UTC, new leads matching the criteria below are found and added to your CRM automatically. Duplicates are always skipped.
            </span>
          </label>
          <div className="grid2">
            <div className="field">
              <label>Keyword</label>
              <input value={auto.keyword} onChange={(e) => setAuto({ ...auto, keyword: e.target.value })}
                onBlur={() => saveAuto(auto)} placeholder="software" />
            </div>
            <div className="field">
              <label>City / region</label>
              <input value={auto.location} onChange={(e) => setAuto({ ...auto, location: e.target.value })}
                onBlur={() => saveAuto(auto)} placeholder="London, UK" />
            </div>
            <div className="field">
              <label>Leads per day (max 30)</label>
              <input type="number" min="1" max="30" value={auto.daily_limit}
                onChange={(e) => setAuto({ ...auto, daily_limit: Number(e.target.value) })}
                onBlur={() => saveAuto(auto)} />
            </div>
          </div>
          <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:8 }}>
            <button className="btn btn-primary btn-sm" onClick={runAutoNow} disabled={!auto.location || autoMsg === 'Running…'}>
              ▶ Run now
            </button>
            <span style={{ fontSize:12, color:'var(--muted)' }}>Use "Run now" to test your criteria immediately instead of waiting for the daily schedule.</span>
          </div>
        </div>
      </div>
    </Page>
  );
}
