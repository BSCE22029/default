import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page, { CoAvatar } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { guessEmails } from '../../lib/emailGuess';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON     = import.meta.env.VITE_SUPABASE_ANON_KEY;

const PRESETS = [
  { ico:'🚀', label:'SaaS',        q:'SaaS software product' },
  { ico:'🎯', label:'Agency',      q:'digital marketing agency' },
  { ico:'💰', label:'Fintech',     q:'fintech financial technology' },
  { ico:'🛒', label:'E-commerce',  q:'ecommerce online retail' },
  { ico:'🏥', label:'Healthcare',  q:'healthcare medtech clinic' },
  { ico:'🤖', label:'AI startup',  q:'artificial intelligence startup' },
  { ico:'☁️', label:'Cloud / DevOps', q:'cloud infrastructure DevOps' },
  { ico:'📱', label:'Mobile app',  q:'mobile app development' },
  { ico:'🎓', label:'EdTech',      q:'education learning platform' },
  { ico:'🏗️', label:'Construction', q:'construction real estate' },
];

const SOURCES = [
  { id:'clearbit', label:'Global Companies',  ico:'🔵', color:'#6366f1', desc:'Real company database with logos & sectors' },
  { id:'github',   label:'Tech Orgs',         ico:'⚫', color:'#1e293b', desc:'Open-source GitHub organizations' },
  { id:'osm',      label:'Local Businesses',  ico:'🟢', color:'#22c55e', desc:'Map-based discovery (needs city)' },
];

// ── Source fetchers ──────────────────────────────────────────────────────────

async function fetchClearbit(query) {
  try {
    const r = await fetch(
      `https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`
    );
    if (!r.ok) return [];
    const data = await r.json();
    return (Array.isArray(data) ? data : []).map((c) => ({
      company:  c.name  || '',
      website:  c.domain ? `https://${c.domain}` : '',
      email:    c.domain ? `info@${c.domain}` : '',
      category: c.sector || 'Business',
      industry: c.industry || '',
      country:  '',
      logo:     c.logo || '',
      lead_score: Math.min(98, Math.max(55, 68 + Math.floor(Math.random() * 28))),
      _source:  'Global',
    })).filter((c) => c.company);
  } catch { return []; }
}

async function fetchGitHub(query) {
  try {
    const r = await fetch(
      `https://api.github.com/search/users?q=${encodeURIComponent(query + ' type:org')}&per_page=8`,
      { headers: { Accept: 'application/vnd.github.v3+json' } }
    );
    if (!r.ok) return [];
    const { items = [] } = await r.json();
    const details = await Promise.allSettled(
      items.slice(0, 6).map((o) =>
        fetch(`https://api.github.com/orgs/${o.login}`, {
          headers: { Accept: 'application/vnd.github.v3+json' },
        }).then((x) => (x.ok ? x.json() : o))
      )
    );
    return details
      .filter((r) => r.status === 'fulfilled')
      .map((r) => r.value)
      .map((o) => {
        const rawDomain = (o.blog || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
        const website   = o.blog
          ? (o.blog.startsWith('http') ? o.blog : `https://${o.blog}`)
          : `https://github.com/${o.login}`;
        return {
          company:  o.name || o.login || '',
          website,
          email:    o.email || (rawDomain ? `info@${rawDomain}` : ''),
          category: 'Tech',
          industry: (o.description || 'Open-source software').slice(0, 60),
          country:  o.location || '',
          avatar:   o.avatar_url || '',
          lead_score: Math.min(92, Math.max(50, 58 + Math.floor(Math.random() * 32))),
          _source:  'Tech',
        };
      })
      .filter((c) => c.company);
  } catch { return []; }
}

async function fetchOSM(query, location) {
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/generate-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ keyword: query, location, limit: 10 }),
    });
    const data = await r.json();
    if (!data.success || !data.leads) return [];
    return data.leads.map((l) => ({ ...l, _source: 'Local' }));
  } catch { return []; }
}

// ── Component ────────────────────────────────────────────────────────────────

export default function Generator() {
  const { orgId } = useAuth();

  const [query,    setQuery]    = useState('');
  const [location, setLocation] = useState('');
  const [busy,     setBusy]     = useState(false);
  const [scanning, setScanning] = useState(''); // which source is running
  const [pct,      setPct]      = useState(0);
  const [results,  setResults]  = useState([]);
  const [msg,      setMsg]      = useState('');
  const [existing, setExisting] = useState(new Set());
  const [added,    setAdded]    = useState(new Set());
  const [emailMap, setEmailMap] = useState({});
  const [showSugg, setShowSugg] = useState('');
  const [enabled,  setEnabled]  = useState({ clearbit: true, github: true, osm: true });

  const [auto,    setAuto]    = useState({ enabled: false, keyword: '', location: '', daily_limit: 10 });
  const [autoMsg, setAutoMsg] = useState('');

  async function loadOrg() {
    const [{ data: org }, { data: leads }] = await Promise.all([
      supabase.from('app_orgs').select('autogen').eq('id', orgId).maybeSingle(),
      supabase.from('app_leads').select('company'),
    ]);
    if (org?.autogen) setAuto((a) => ({ ...a, ...org.autogen }));
    setExisting(new Set((leads || []).map((l) => (l.company || '').toLowerCase())));
  }
  useEffect(() => { if (orgId) loadOrg(); }, [orgId]);

  async function generate() {
    const q = query.trim();
    if (!q) { setMsg('Pick a preset or type a keyword first.'); return; }
    setBusy(true); setMsg(''); setResults([]); setAdded(new Set()); setEmailMap({}); setShowSugg('');

    const all = [];
    const push = (items) => { all.push(...items); setResults([...all]); };

    // Source 1: Clearbit (global companies)
    if (enabled.clearbit) {
      setScanning('clearbit'); setPct(15);
      const r = await fetchClearbit(q);
      push(r); setPct(40);
    }

    // Source 2: GitHub (tech orgs)
    if (enabled.github) {
      setScanning('github'); setPct(55);
      const r = await fetchGitHub(q);
      push(r); setPct(75);
    }

    // Source 3: OpenStreetMap (local businesses, only if city given)
    if (enabled.osm && location.trim()) {
      setScanning('osm'); setPct(85);
      const r = await fetchOSM(q, location.trim());
      push(r); setPct(100);
    }

    setScanning(''); setBusy(false);
    if (!all.length) setMsg('No results found — try a different keyword or enable more sources.');
  }

  function resolvedEmail(l) {
    return emailMap[l.company.toLowerCase()] || l.email || '';
  }

  async function addOne(l) {
    await supabase.from('app_leads').insert({
      org_id: orgId, company: l.company, website: l.website || '',
      email: resolvedEmail(l), industry: l.industry || '',
      country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead',
      notes: `Source: ${l._source || 'Generator'} — ${query}`,
    });
    setExisting((s) => new Set(s).add(l.company.toLowerCase()));
    setAdded((s)    => new Set(s).add(l.company.toLowerCase()));
  }

  async function addAll() {
    const fresh = results.filter((l) => !existing.has(l.company.toLowerCase()));
    if (!fresh.length) { setMsg('All results are already in your CRM.'); return; }
    await supabase.from('app_leads').insert(fresh.map((l) => ({
      org_id: orgId, company: l.company, website: l.website || '',
      email: resolvedEmail(l), industry: l.industry || '',
      country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead',
      notes: `Source: ${l._source || 'Generator'} — ${query}`,
    })));
    const names = new Set(fresh.map((l) => l.company.toLowerCase()));
    setExisting((s) => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
    setAdded((s)    => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
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
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
    const data = await res.json();
    const cnt  = (data.summary || []).reduce((s, x) => s + (x.added || 0), 0);
    setAutoMsg(data.success ? `✅ Added ${cnt} new leads` : ('Error: ' + (data.error || 'failed')));
    loadOrg();
  }

  const newCount = results.filter((l) => !existing.has(l.company.toLowerCase())).length;
  const scanInfo = SOURCES.find((s) => s.id === scanning);

  return (
    <Page title="Lead Generator">

      {/* ── Search panel ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-body" style={{ paddingTop: 20 }}>

          {/* Heading */}
          <div style={{ marginBottom: 18 }}>
            <h3 style={{ fontSize: 18, fontWeight: 800, marginBottom: 4 }}>🌐 Find leads from the internet</h3>
            <p style={{ fontSize: 13, color: 'var(--muted)', margin: 0 }}>
              Searches multiple sources simultaneously — company databases, GitHub tech orgs, and local business maps.
            </p>
          </div>

          {/* Preset pills */}
          <div style={{ marginBottom: 16 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>
              Quick presets
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => {
                const active = query === p.q;
                return (
                  <button key={p.q} type="button" className="sugg-chip"
                    style={{ fontSize: 12, padding: '5px 13px', fontWeight: 700, background: active ? '#e0e7ff' : undefined, color: active ? '#4338ca' : undefined, borderColor: active ? '#818cf8' : undefined }}
                    onClick={() => setQuery(active ? '' : p.q)}>
                    {p.ico} {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search row */}
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
            <input
              style={{ flex: 2, minWidth: 220 }}
              placeholder="What kind of leads? e.g. fintech startup, SaaS agency, healthcare clinic"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && generate()}
            />
            <input
              style={{ flex: 1, minWidth: 150 }}
              placeholder="City (for local source)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && generate()}
            />
            <button className="btn btn-primary" style={{ minWidth: 150, height: 42, fontSize: 14 }}
              disabled={busy || !query.trim()} onClick={generate}>
              {busy ? '⏳ Searching…' : '🔍 Find Leads'}
            </button>
            {newCount > 0 && !busy && (
              <button className="btn btn-ghost" style={{ height: 42 }} onClick={addAll}>
                + Add all {newCount}
              </button>
            )}
          </div>

          {/* Source toggles */}
          <div style={{ display: 'flex', gap: 0, border: '1px solid var(--border)', borderRadius: 10, overflow: 'hidden', marginBottom: 14 }}>
            {SOURCES.map((s, i) => (
              <label key={s.id} style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 14px', cursor: 'pointer', borderRight: i < SOURCES.length - 1 ? '1px solid var(--border)' : 'none', background: enabled[s.id] ? s.color + '08' : undefined, transition: 'background .15s' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input type="checkbox" checked={enabled[s.id]} style={{ accentColor: s.color }}
                    onChange={(e) => setEnabled((x) => ({ ...x, [s.id]: e.target.checked }))} />
                  <span style={{ fontWeight: 700, fontSize: 13, color: enabled[s.id] ? s.color : 'var(--muted)' }}>{s.ico} {s.label}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--muted)', paddingLeft: 22 }}>{s.desc}</span>
              </label>
            ))}
          </div>

          {/* Progress bar */}
          {busy && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--muted)', marginBottom: 5 }}>
                <span style={{ fontWeight: 600 }}>
                  {scanInfo ? `${scanInfo.ico} Searching ${scanInfo.label}…` : 'Almost done…'}
                </span>
                <span>{pct}%</span>
              </div>
              <div style={{ height: 5, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                <div style={{ height: '100%', borderRadius: 99, transition: 'width .5s ease',
                  background: scanInfo ? `linear-gradient(90deg, ${scanInfo.color}, ${scanInfo.color}88)` : 'linear-gradient(90deg,#6366f1,#22c55e)',
                  width: `${pct}%` }} />
              </div>
              {results.length > 0 && (
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 5 }}>
                  {results.length} result{results.length !== 1 ? 's' : ''} so far — more loading…
                </div>
              )}
            </div>
          )}

          {msg && (
            <div className={`alert ${msg.startsWith('✅') ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 10, marginBottom: 0 }}>
              {msg}
            </div>
          )}
        </div>
      </div>

      {/* ── Results ──────────────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>
              <b style={{ color: 'var(--text)' }}>{results.length}</b> leads found
              {newCount > 0 && <> · <span style={{ color: '#22c55e', fontWeight: 700 }}>{newCount} new</span></>}
              {results.length - newCount > 0 && <> · {results.length - newCount} already in CRM</>}
            </div>
            {newCount > 0 && (
              <button className="btn btn-primary btn-sm" onClick={addAll}>+ Add all {newCount} new</button>
            )}
          </div>
          <div className="gen-grid">
            {results.map((l, i) => {
              const key       = l.company.toLowerCase();
              const inCrm     = existing.has(key);
              const justAdded = added.has(key);
              const domain    = (l.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
              const score     = l.lead_score || 55;
              const suggs     = guessEmails(l.website);
              const chosen    = emailMap[key];
              const hasEmail  = chosen || l.email;
              const srcMeta   = SOURCES.find((s) => s.label.split(' ')[0] === l._source) || SOURCES[0];
              const srcColor  = l._source === 'Global' ? '#6366f1' : l._source === 'Tech' ? '#0f172a' : '#22c55e';

              return (
                <div key={`${l.company}-${i}`} className={`gen-card ${inCrm ? 'gen-card-added' : ''}`}
                  style={{ display: 'flex', flexDirection: 'column' }}>

                  {/* Header */}
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                    {l.logo || l.avatar ? (
                      <img src={l.logo || l.avatar} alt={l.company}
                        style={{ width: 38, height: 38, borderRadius: 9, objectFit: 'cover', border: '1.5px solid var(--border)', flexShrink: 0 }} />
                    ) : (
                      <CoAvatar company={l.company} size={38} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 800, fontSize: 14, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.company}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {l.industry || l.category || 'Business'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, flexShrink: 0 }}>
                      <span className={`score-badge ${score >= 75 ? 'hot' : score >= 55 ? 'warm' : 'cold'}`}>{score}</span>
                      {l._source && (
                        <span style={{ fontSize: 9, fontWeight: 800, color: srcColor, background: srcColor + '18', padding: '1px 6px', borderRadius: 20 }}>
                          {l._source}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Website */}
                  {l.website && (
                    <div style={{ fontSize: 12, marginBottom: 5 }}>
                      🌐 <a href={l.website.startsWith('http') ? l.website : 'https://' + l.website}
                        target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{domain}</a>
                    </div>
                  )}

                  {/* Email picker */}
                  <div style={{ marginBottom: 6 }}>
                    {hasEmail ? (
                      <div style={{ fontSize: 12, color: 'var(--muted)', display: 'flex', alignItems: 'center', gap: 5 }}>
                        ✉️ <span style={{ color: chosen ? '#6366f1' : undefined, wordBreak: 'break-all' }}>{chosen || l.email}</span>
                        {suggs.length > 0 && (
                          <button type="button"
                            style={{ fontSize: 10, color: 'var(--muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, textDecoration: 'underline', flexShrink: 0 }}
                            onClick={() => setShowSugg(showSugg === key ? '' : key)}>
                            change
                          </button>
                        )}
                      </div>
                    ) : suggs.length > 0 ? (
                      <button type="button" className="find-email-btn"
                        onClick={() => setShowSugg(showSugg === key ? '' : key)}>
                        🔍 Find email
                      </button>
                    ) : null}
                    {showSugg === key && suggs.length > 0 && (
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3, marginTop: 5 }}>
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

                  {l.country && (
                    <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 8 }}>📍 {l.country}</div>
                  )}

                  {/* CTA */}
                  <div style={{ marginTop: 'auto' }}>
                    {inCrm ? (
                      <div style={{ fontSize: 12, fontWeight: 700, color: justAdded ? '#22c55e' : '#94a3b8', paddingTop: 4 }}>
                        {justAdded ? '✅ Added to CRM' : '✓ Already in CRM'}
                      </div>
                    ) : (
                      <button className="btn btn-sm btn-primary" style={{ width: '100%' }} onClick={() => addOne(l)}>
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

      {/* ── Auto-pilot ───────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>🤖 Auto-pilot — daily lead discovery</h3>
          {autoMsg && <span style={{ fontSize: 12, color: '#22c55e', fontWeight: 700 }}>{autoMsg}</span>}
        </div>
        <div className="card-body">

          <label style={{ display: 'flex', gap: 12, cursor: 'pointer', alignItems: 'flex-start', marginBottom: 18, padding: '12px 14px', background: auto.enabled ? '#f0fdf4' : 'var(--bg)', border: `1.5px solid ${auto.enabled ? '#86efac' : 'var(--border)'}`, borderRadius: 10, transition: 'all .15s' }}>
            <input type="checkbox" checked={auto.enabled} style={{ marginTop: 2, accentColor: '#22c55e', flexShrink: 0 }}
              onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} />
            <div>
              <div style={{ fontWeight: 700, fontSize: 14, color: auto.enabled ? '#15803d' : 'var(--text)', marginBottom: 2 }}>
                {auto.enabled ? '✅ Auto-pilot is ON' : 'Enable auto-pilot'}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>
                Every day at 08:00 UTC, new leads matching your criteria are found and added automatically. Duplicates are always skipped.
              </div>
            </div>
          </label>

          {/* Quick preset for auto */}
          <div style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 8 }}>Target industry</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {PRESETS.map((p) => {
                const active = auto.keyword === p.q;
                return (
                  <button key={p.q} type="button" className="sugg-chip"
                    style={{ fontSize: 11, padding: '4px 10px', background: active ? '#e0e7ff' : undefined, color: active ? '#4338ca' : undefined, borderColor: active ? '#818cf8' : undefined }}
                    onClick={() => saveAuto({ ...auto, keyword: p.q })}>
                    {p.ico} {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid2">
            <div className="field">
              <label>Custom keyword</label>
              <input value={auto.keyword} placeholder="software agency, SaaS startup…"
                onChange={(e) => setAuto({ ...auto, keyword: e.target.value })}
                onBlur={() => saveAuto(auto)} />
            </div>
            <div className="field">
              <label>City / region (for local search)</label>
              <input value={auto.location} placeholder="London, UK"
                onChange={(e) => setAuto({ ...auto, location: e.target.value })}
                onBlur={() => saveAuto(auto)} />
            </div>
          </div>

          <div className="field" style={{ marginBottom: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <label style={{ margin: 0 }}>Leads per day</label>
              <b style={{ fontSize: 13, color: '#6366f1' }}>{auto.daily_limit}</b>
            </div>
            <input type="range" min="1" max="30" value={auto.daily_limit}
              style={{ width: '100%', accentColor: '#6366f1' }}
              onChange={(e) => setAuto({ ...auto, daily_limit: Number(e.target.value) })}
              onMouseUp={() => saveAuto(auto)} />
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--muted)', marginTop: 2 }}>
              <span>1 / day</span><span>15 / day</span><span>30 / day</span>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <button className="btn btn-primary btn-sm" onClick={runAutoNow}
              disabled={!auto.keyword || autoMsg === 'Running…'}>
              ▶ Run now
            </button>
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>
              Test immediately without waiting for tomorrow's scheduled run.
            </span>
          </div>
        </div>
      </div>
    </Page>
  );
}
