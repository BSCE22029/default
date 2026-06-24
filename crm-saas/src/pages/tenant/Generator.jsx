import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY;

export default function Generator() {
  const { orgId } = useAuth();
  const [keyword, setKeyword] = useState('');
  const [location, setLocation] = useState('');
  const [limit, setLimit] = useState(12);
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState([]);
  const [source, setSource] = useState('');
  const [msg, setMsg] = useState('');
  const [existing, setExisting] = useState(new Set());

  // automation settings
  const [auto, setAuto] = useState({ enabled: false, keyword: '', location: '', daily_limit: 10 });
  const [autoMsg, setAutoMsg] = useState('');

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
    setBusy(true); setMsg(''); setResults([]);
    try {
      const res = await fetch(`${SUPA_URL}/functions/v1/generate-leads`, {
        method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON },
        body: JSON.stringify({ keyword, location, limit: Number(limit) }),
      });
      const data = await res.json();
      if (!data.success) throw new Error(data.error || 'Generation failed');
      setResults(data.leads || []); setSource(data.source);
      if (!data.leads?.length) setMsg('No businesses found — try a broader keyword or a known city.');
    } catch (e) { setMsg('Error: ' + e.message); }
    setBusy(false);
  }

  async function addOne(l) {
    await supabase.from('app_leads').insert({
      org_id: orgId, company: l.company, website: l.website || '', email: l.email || '',
      industry: l.industry || '', country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead', notes: 'Generated from ' + (location || 'web'),
    });
    setExisting((s) => new Set(s).add(l.company.toLowerCase()));
  }

  async function addAll() {
    const fresh = results.filter((l) => !existing.has(l.company.toLowerCase()));
    if (!fresh.length) { setMsg('All generated leads are already in your CRM.'); return; }
    await supabase.from('app_leads').insert(fresh.map((l) => ({
      org_id: orgId, company: l.company, website: l.website || '', email: l.email || '',
      industry: l.industry || '', country: l.country || '', category: l.category || '',
      lead_score: l.lead_score || 55, status: 'New Lead', notes: 'Generated from ' + (location || 'web'),
    })));
    setExisting((s) => { const n = new Set(s); fresh.forEach((l) => n.add(l.company.toLowerCase())); return n; });
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
    const res = await fetch(`${SUPA_URL}/functions/v1/autogen-run`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: '{}',
    });
    const data = await res.json();
    const added = (data.summary || []).reduce((s, x) => s + (x.added || 0), 0);
    setAutoMsg(data.success ? `✅ Added ${added} new leads` : ('Error: ' + (data.error || 'failed')));
    loadOrg();
  }

  return (
    <Page title="Lead Generator">
      {/* Manual generation */}
      <div className="card" style={{ marginBottom: 18 }}>
        <div className="card-head"><h3>⚡ Generate leads from the web</h3>{source && <span style={{ fontSize: 12, color: 'var(--muted)' }}>source: {source}</span>}</div>
        <div className="card-body">
          <p style={{ color: 'var(--muted)', fontSize: 13, marginBottom: 14 }}>
            Pulls real businesses from public OpenStreetMap business data. Enter a city (required) and an optional keyword.
          </p>
          <div className="toolbar">
            <input placeholder="Keyword (e.g. software, agency, consulting)" value={keyword} onChange={(e) => setKeyword(e.target.value)} style={{ minWidth: 240 }} />
            <input placeholder="City (e.g. London, UK)" value={location} onChange={(e) => setLocation(e.target.value)} style={{ minWidth: 180 }} />
            <input type="number" min="1" max="30" value={limit} onChange={(e) => setLimit(e.target.value)} style={{ width: 80 }} title="How many" />
            <button className="btn btn-primary" disabled={busy || !location} onClick={generate}>{busy ? 'Searching…' : '⚡ Generate'}</button>
            {results.length > 0 && <button className="btn btn-ghost" onClick={addAll}>+ Add all to CRM</button>}
          </div>
          {msg && <div className={`alert ${msg.startsWith('✅') ? 'alert-ok' : 'alert-error'}`} style={{ marginTop: 12 }}>{msg}</div>}

          {results.length > 0 && (
            <div style={{ marginTop: 14, overflowX: 'auto' }}>
              <table>
                <thead><tr><th>Company</th><th>Website</th><th>Email / Phone</th><th>Country</th><th>Score</th><th></th></tr></thead>
                <tbody>
                  {results.map((l, i) => {
                    const inCrm = existing.has(l.company.toLowerCase());
                    return (
                      <tr key={i}>
                        <td><b>{l.company}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.industry}</div></td>
                        <td style={{ fontSize: 12 }}>{l.website ? <a href={(l.website.startsWith('http') ? '' : 'https://') + l.website} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{l.website}</a> : '—'}</td>
                        <td style={{ fontSize: 12 }}>{l.email || l.phone || '—'}</td>
                        <td style={{ fontSize: 12 }}>{l.country}</td>
                        <td><b>{l.lead_score}</b></td>
                        <td>{inCrm ? <span style={{ fontSize: 12, color: 'var(--green)' }}>✓ In CRM</span>
                          : <button className="btn btn-sm" style={{ background: '#f0fdf4', color: '#166534' }} onClick={() => addOne(l)}>+ Add</button>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Automation */}
      <div className="card">
        <div className="card-head"><h3>🤖 Automated daily generation</h3>{autoMsg && <span style={{ fontSize: 12, color: 'var(--green)' }}>{autoMsg}</span>}</div>
        <div className="card-body">
          <label className="row" style={{ gap: 8, marginBottom: 14, cursor: 'pointer' }}>
            <input type="checkbox" checked={auto.enabled} onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} />
            <span><b>Enable auto-generation</b> — every day at 08:00 UTC, new leads matching the criteria below are found and added to your CRM automatically (duplicates skipped).</span>
          </label>
          <div className="grid2">
            <div className="field"><label>Keyword</label><input value={auto.keyword} onChange={(e) => setAuto({ ...auto, keyword: e.target.value })} onBlur={() => saveAuto(auto)} placeholder="software" /></div>
            <div className="field"><label>City</label><input value={auto.location} onChange={(e) => setAuto({ ...auto, location: e.target.value })} onBlur={() => saveAuto(auto)} placeholder="London, UK" /></div>
            <div className="field"><label>Leads per day</label><input type="number" min="1" max="30" value={auto.daily_limit} onChange={(e) => setAuto({ ...auto, daily_limit: Number(e.target.value) })} onBlur={() => saveAuto(auto)} /></div>
          </div>
          <button className="btn btn-primary btn-sm" onClick={runAutoNow} disabled={!auto.location}>▶ Run now</button>
          <p className="sub" style={{ color: 'var(--muted)', marginTop: 10 }}>Use “Run now” to test your criteria immediately instead of waiting for the daily schedule.</p>
        </div>
      </div>
    </Page>
  );
}
