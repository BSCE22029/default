import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page, { CoAvatar } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { guessEmails } from '../../lib/emailGuess';
import { verifyLeads, genuineRank, domainOf } from '../../lib/verifyLead';

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL;
const ANON     = import.meta.env.VITE_SUPABASE_ANON_KEY;

const PRESETS = [
  { label:'SaaS',           q:'SaaS software product company' },
  { label:'Agency',         q:'digital marketing web design agency' },
  { label:'Fintech',        q:'fintech financial technology startup' },
  { label:'E-commerce',     q:'ecommerce online retail store' },
  { label:'Healthcare',     q:'healthcare clinic medical technology' },
  { label:'AI',             q:'artificial intelligence machine learning startup' },
  { label:'Cloud / DevOps', q:'cloud infrastructure DevOps company' },
  { label:'Mobile',         q:'mobile app development company' },
  { label:'EdTech',         q:'education learning technology platform' },
  { label:'Real Estate',    q:'real estate property management company' },
];

const SOURCES = [
  { id:'clearbit',  label:'Clearbit',          color:'#6366f1', free:true,  desc:'Global company database — logos, sectors, domains' },
  { id:'github',    label:'GitHub Orgs',        color:'#0f172a', free:true,  desc:'Real open-source tech organizations with websites' },
  { id:'opencorp',  label:'Company Registry',   color:'#0369a1', free:true,  desc:'Public corporate registrations — real, verifiable companies' },
  { id:'maps',      label:'Google Maps',        color:'#EA4335', free:false, keyField:'maps_key',    desc:'Local businesses with real phone numbers' },
  { id:'apollo',    label:'Apollo.io',          color:'#5C4EE5', free:false, keyField:'apollo_key',  desc:'B2B leads with direct emails & contacts' },
  { id:'hunter',    label:'Hunter.io',          color:'#f59e0b', free:false, keyField:'hunter_key',  desc:'Verified real emails by domain — 25 free/month' },
  { id:'osm',       label:'OpenStreetMap',      color:'#22c55e', free:true,  desc:'Map-based local discovery (enter a city)' },
  { id:'ai',        label:'AI Scoring',         color:'#7c3aed', free:false, keyField:'anthropic_key', desc:'Claude AI analyzes every company — ranks HOT / WARM / COLD by fit for IT services' },
  { id:'verify',    label:'Genuine Check',      color:'#059669', free:true,  desc:'Verifies every lead is REAL — live DNS + email deliverability (MX) + domain age + website liveness. Flags dead or fake companies' },
];

// ── Fetchers ─────────────────────────────────────────────────────────────────

async function fetchClearbit(query) {
  try {
    const r = await fetch(`https://autocomplete.clearbit.com/v1/companies/suggest?query=${encodeURIComponent(query)}`);
    if (!r.ok) return [];
    const data = await r.json();
    return (Array.isArray(data) ? data : []).map((c) => ({
      company: c.name || '', website: c.domain ? `https://${c.domain}` : '',
      email: c.domain ? `info@${c.domain}` : '', category: c.sector || 'Business',
      industry: c.industry || '', country: '', logo: c.logo || '',
      lead_score: Math.min(98, Math.max(55, 68 + Math.floor(Math.random() * 28))), _source: 'Clearbit',
    })).filter((c) => c.company);
  } catch { return []; }
}

async function fetchGitHub(query) {
  try {
    const r = await fetch(`https://api.github.com/search/users?q=${encodeURIComponent(query + ' type:org')}&per_page=8`, { headers: { Accept: 'application/vnd.github.v3+json' } });
    if (!r.ok) return [];
    const { items = [] } = await r.json();
    const details = await Promise.allSettled(items.slice(0, 6).map((o) => fetch(`https://api.github.com/orgs/${o.login}`, { headers: { Accept: 'application/vnd.github.v3+json' } }).then((x) => (x.ok ? x.json() : o))));
    return details.filter((r) => r.status === 'fulfilled').map((r) => r.value).map((o) => {
      const rawDomain = (o.blog || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      const website = o.blog ? (o.blog.startsWith('http') ? o.blog : `https://${o.blog}`) : `https://github.com/${o.login}`;
      return { company: o.name || o.login || '', website, email: o.email || (rawDomain ? `info@${rawDomain}` : ''), category: 'Tech', industry: (o.description || 'Open-source software').slice(0, 60), country: o.location || '', avatar: o.avatar_url || '', lead_score: Math.min(92, Math.max(50, 58 + Math.floor(Math.random() * 32))), _source: 'GitHub' };
    }).filter((c) => c.company);
  } catch { return []; }
}

async function fetchOpenCorporates(query) {
  try {
    const r = await fetch(`https://api.opencorporates.com/v0.4/companies/search?q=${encodeURIComponent(query)}&per_page=20&current_status=active&format=json`);
    if (!r.ok) return [];
    const data = await r.json();
    return (data.results?.companies || []).map(({ company: c }) => {
      const addr = c.registered_address;
      const jCode = (c.jurisdiction_code || '').split('_');
      return {
        company: (c.name || '').replace(/\b(LTD|LLC|INC|CORP|LIMITED|PLC)\b\.?/gi, '').trim() || c.name || '',
        website: '', email: '', phone: '', category: c.company_type || 'Registered Business',
        industry: c.company_type || 'Business',
        country: [addr?.country || jCode[0]?.toUpperCase(), jCode[1]?.toUpperCase()].filter(Boolean).join(' · '),
        address: addr ? [addr.street_address, addr.locality, addr.region, addr.country].filter(Boolean).join(', ') : '',
        registered: c.incorporation_date, companyNumber: c.company_number,
        lead_score: Math.min(82, Math.max(50, 58 + Math.floor(Math.random() * 22))),
        _source: 'Registry', _oc_url: c.opencorporates_url,
      };
    }).filter((c) => c.company && c.company.length > 1 && !/^\d+$/.test(c.company));
  } catch { return []; }
}

async function fetchGoogleMaps(query, location, apiKey) {
  if (!apiKey) return [];
  try {
    const res = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': apiKey, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.rating,places.userRatingCount,places.businessStatus,places.types' },
      body: JSON.stringify({ textQuery: location ? `${query} near ${location}` : query, maxResultCount: 20, languageCode: 'en' }),
    });
    if (!res.ok) return [];
    const { places = [] } = await res.json();
    return places.filter((p) => p.businessStatus !== 'CLOSED_PERMANENTLY').map((p) => {
      const domain = (p.websiteUri || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
      const addrParts = (p.formattedAddress || '').split(',');
      return { company: p.displayName?.text || '', website: p.websiteUri || '', email: domain ? `info@${domain}` : '', phone: p.nationalPhoneNumber || '', address: p.formattedAddress || '', category: 'Local Business', industry: (p.types || []).slice(0, 2).join(', ').replace(/_/g, ' '), country: addrParts[addrParts.length - 1]?.trim() || location || '', rating: p.rating, ratingCount: p.userRatingCount, lead_score: Math.min(96, Math.max(52, 60 + Math.round((p.rating || 3.5) * 8))), _source: 'Maps' };
    }).filter((c) => c.company);
  } catch { return []; }
}

async function fetchApollo(query, apiKey) {
  if (!apiKey) return [];
  try {
    const res = await fetch('https://api.apollo.io/v1/mixed_people/search', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-cache' }, body: JSON.stringify({ api_key: apiKey, q_keywords: query, per_page: 10, page: 1 }) });
    if (!res.ok) return [];
    const data = await res.json();
    const seen = new Set();
    return (data.people || []).filter((p) => { const n = p.organization?.name; if (!n || seen.has(n)) return false; seen.add(n); return true; }).map((p) => ({
      company: p.organization?.name || '', website: p.organization?.website_url || '',
      email: p.email || (p.organization?.website_url ? `info@${p.organization.website_url.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '')}` : ''),
      contact: [p.first_name, p.last_name].filter(Boolean).join(' '), category: p.organization?.industry || 'Business',
      industry: p.title || p.organization?.industry || '', country: p.organization?.country || '',
      avatar: p.photo_url || '', employees: p.organization?.estimated_num_employees,
      lead_score: Math.min(96, Math.max(62, 72 + Math.floor(Math.random() * 22))), _source: 'Apollo',
    })).filter((c) => c.company);
  } catch { return []; }
}

async function enrichWithHunter(companies, apiKey) {
  if (!apiKey || !companies.length) return {};
  const enriched = {};
  const toEnrich = companies.filter((c) => { const d = (c.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, ''); return d && d.includes('.') && !d.includes('github.com'); }).slice(0, 8);
  await Promise.allSettled(toEnrich.map(async (c) => {
    const domain = (c.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    if (!domain) return;
    try {
      const r = await fetch(`https://api.hunter.io/v2/domain-search?domain=${encodeURIComponent(domain)}&limit=5&api_key=${encodeURIComponent(apiKey)}`);
      if (!r.ok) return;
      const { data } = await r.json();
      const top = (data?.emails || []).filter((e) => e.confidence >= 60).sort((a, b) => b.confidence - a.confidence)[0];
      if (top) enriched[c.company.toLowerCase()] = { email: top.value, confidence: top.confidence, type: top.type, firstName: top.first_name, lastName: top.last_name, position: top.position };
    } catch {}
  }));
  return enriched;
}

async function fetchOSM(query, location) {
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/generate-leads`, { method: 'POST', headers: { 'Content-Type': 'application/json', apikey: ANON }, body: JSON.stringify({ keyword: query, location, limit: 10 }) });
    const data = await r.json();
    if (!data.success || !data.leads) return [];
    return data.leads.map((l) => ({ ...l, _source: 'OSM' }));
  } catch { return []; }
}

async function runAiScoring(companies, query, anthropicKey) {
  try {
    const r = await fetch(`${SUPA_URL}/functions/v1/score-leads`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: ANON },
      body: JSON.stringify({ companies, query, api_key: anthropicKey }),
    });
    const data = await r.json();
    return data.scored || companies;
  } catch { return companies; }
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Generator() {
  const { orgId } = useAuth();

  const [query,        setQuery]        = useState('');
  const [location,     setLocation]     = useState('');
  const [busy,         setBusy]         = useState(false);
  const [scanning,     setScanning]     = useState('');
  const [pct,          setPct]          = useState(0);
  const [results,      setResults]      = useState([]);
  const [msg,          setMsg]          = useState('');
  const [existing,     setExisting]     = useState(new Set());
  const [added,        setAdded]        = useState(new Set());
  const [emailMap,     setEmailMap]     = useState({});
  const [hunterMap,    setHunterMap]    = useState({});
  const [showSugg,     setShowSugg]     = useState('');
  const [hotOnly,      setHotOnly]      = useState(true);
  const [genuineOnly,  setGenuineOnly]  = useState(false);
  const [enabled,      setEnabled]      = useState({ clearbit:true, github:true, opencorp:true, maps:true, apollo:true, hunter:true, osm:false, ai:true, verify:true });
  const [showKeys,     setShowKeys]     = useState(false);

  const [mapsKey,      setMapsKey]      = useState('');
  const [apolloKey,    setApolloKey]    = useState('');
  const [hunterKey,    setHunterKey]    = useState('');
  const [anthropicKey, setAnthropicKey] = useState('');
  const [keySaved,     setKeySaved]     = useState('');

  const [auto,    setAuto]    = useState({ enabled:false, keyword:'', location:'', daily_limit:10 });
  const [autoMsg, setAutoMsg] = useState('');

  async function loadOrg() {
    const [{ data: org }, { data: leads }] = await Promise.all([
      supabase.from('app_orgs').select('autogen').eq('id', orgId).maybeSingle(),
      supabase.from('app_leads').select('company'),
    ]);
    if (org?.autogen) {
      setAuto((a) => ({ ...a, ...org.autogen }));
      if (org.autogen.maps_key)      setMapsKey(org.autogen.maps_key);
      if (org.autogen.apollo_key)    setApolloKey(org.autogen.apollo_key);
      if (org.autogen.hunter_key)    setHunterKey(org.autogen.hunter_key);
      if (org.autogen.anthropic_key) setAnthropicKey(org.autogen.anthropic_key);
    }
    setExisting(new Set((leads || []).map((l) => (l.company || '').toLowerCase())));
  }
  useEffect(() => { if (orgId) loadOrg(); }, [orgId]);

  async function saveApiKey(field, value) {
    const next = { ...auto, [field]: value };
    setAuto(next);
    await supabase.from('app_orgs').update({ autogen: next }).eq('id', orgId);
    setKeySaved(field); setTimeout(() => setKeySaved(''), 2000);
  }

  async function generate() {
    const q = query.trim();
    if (!q) { setMsg('Pick a preset or type a keyword first.'); return; }
    setBusy(true); setMsg(''); setResults([]); setAdded(new Set()); setEmailMap({}); setHunterMap({}); setShowSugg(''); setPct(0);

    const all  = [];
    const push = (items) => { all.push(...items); setResults([...all]); };

    if (enabled.clearbit)  { setScanning('clearbit');  setPct(6);  push(await fetchClearbit(q));                        setPct(16); }
    if (enabled.github)    { setScanning('github');    setPct(20); push(await fetchGitHub(q));                          setPct(32); }
    if (enabled.opencorp)  { setScanning('opencorp');  setPct(36); push(await fetchOpenCorporates(q));                  setPct(46); }
    if (enabled.maps    && mapsKey)   { setScanning('maps');   setPct(50); push(await fetchGoogleMaps(q, location, mapsKey));  setPct(62); }
    if (enabled.apollo  && apolloKey) { setScanning('apollo'); setPct(66); push(await fetchApollo(q, apolloKey));               setPct(76); }
    if (enabled.osm     && location.trim()) { setScanning('osm'); push(await fetchOSM(q, location.trim())); setPct(80); }

    // Dedupe across sources — same domain or same company name = one lead
    {
      const seen = new Set();
      const unique = all.filter((l) => {
        const k = domainOf(l.website) || l.company.toLowerCase();
        if (seen.has(k)) return false;
        seen.add(k); return true;
      });
      all.length = 0; all.push(...unique);
      setResults([...all]);
    }

    // Hunter email enrichment
    if (enabled.hunter && hunterKey && all.length) {
      setScanning('hunter'); setPct(82);
      const hMap = await enrichWithHunter(all, hunterKey);
      setHunterMap(hMap);
      setPct(88);
    }

    // AI scoring — analyze every company, rank by IT services fit
    if (enabled.ai && anthropicKey && all.length) {
      setScanning('ai'); setPct(86);
      const scored = await runAiScoring(all, q, anthropicKey);
      // Sort: HOT first, then WARM, then COLD
      scored.sort((a, b) => (b.ai_score || 0) - (a.ai_score || 0));
      all.length = 0;
      all.push(...scored);
      setResults([...all]);
      setPct(90);
    }

    // Genuine check — prove each lead is a real, contactable business
    // (DNS + MX + domain age + liveness). Re-rank: real beats relevant.
    if (enabled.verify && all.length) {
      setScanning('verify');
      const base = 90;
      await verifyLeads(all, (done) => {
        setPct(base + Math.round((done / all.length) * 8));
        setResults([...all]);
      });
      all.sort((a, b) => genuineRank(b) - genuineRank(a));
      setResults([...all]);
    }

    setScanning(''); setBusy(false); setPct(100);
    if (!all.length) setMsg('No results. Try a different keyword or enable more sources.');
  }

  function resolvedEmail(l) {
    const key = l.company.toLowerCase();
    return emailMap[key] || hunterMap[key]?.email || l.email || '';
  }

  // Final CRM score: blend topical fit with proof the business is real.
  function crmScore(l) {
    const fit = l.ai_score || l.lead_score || 55;
    return l.genuine_score !== undefined ? Math.round(genuineRank(l)) : fit;
  }

  async function addOne(l) {
    const hEntry = hunterMap[l.company.toLowerCase()];
    await supabase.from('app_leads').insert({
      org_id: orgId, company: l.company, website: l.website || '',
      email: resolvedEmail(l), industry: l.industry || '',
      country: l.country || '', category: l.category || '',
      lead_score: crmScore(l), status: 'New Lead',
      contact: l.contact || '',
      notes: [
        `Source: ${l._source || 'Generator'} — ${query}`,
        l.genuine   ? `Genuine check: ${l.genuine} (${l.genuine_score}/100) — ${(l.genuine_reasons || []).join('; ')}` : '',
        l.ai_score  ? `AI Score: ${l.ai_score}/100 — ${l.ai_reason}` : '',
        l.phone     ? `Phone: ${l.phone}` : '',
        l.address   ? `Address: ${l.address}` : '',
        l.rating    ? `Rating: ${l.rating}/5 (${l.ratingCount || 0} reviews)` : '',
        l.employees ? `Employees: ~${l.employees}` : '',
        hEntry      ? `Email verified by Hunter.io — ${hEntry.confidence}% confidence` : '',
        l.registered    ? `Incorporated: ${l.registered}` : '',
        l.companyNumber ? `Company #: ${l.companyNumber}` : '',
        l._oc_url       ? `Registry: ${l._oc_url}` : '',
      ].filter(Boolean).join('\n'),
    });
    setExisting((s) => new Set(s).add(l.company.toLowerCase()));
    setAdded((s)    => new Set(s).add(l.company.toLowerCase()));
  }

  async function addAll() {
    const toAdd = displayResults.filter((l) => !existing.has(l.company.toLowerCase()));
    if (!toAdd.length) { setMsg('All visible leads are already in your CRM.'); return; }
    await supabase.from('app_leads').insert(toAdd.map((l) => {
      const hEntry = hunterMap[l.company.toLowerCase()];
      return {
        org_id: orgId, company: l.company, website: l.website || '',
        email: resolvedEmail(l), industry: l.industry || '',
        country: l.country || '', category: l.category || '',
        lead_score: crmScore(l), status: 'New Lead', contact: l.contact || '',
        notes: [
          `Source: ${l._source || 'Generator'} — ${query}`,
          l.genuine  ? `Genuine check: ${l.genuine} (${l.genuine_score}/100) — ${(l.genuine_reasons || []).join('; ')}` : '',
          l.ai_score ? `AI Score: ${l.ai_score}/100 — ${l.ai_reason}` : '',
          l.phone    ? `Phone: ${l.phone}` : '',
          l.address  ? `Address: ${l.address}` : '',
          hEntry     ? `Email verified by Hunter.io — ${hEntry.confidence}% confidence` : '',
          l.registered ? `Incorporated: ${l.registered}` : '',
        ].filter(Boolean).join('\n'),
      };
    }));
    const names = new Set(toAdd.map((l) => l.company.toLowerCase()));
    setExisting((s) => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
    setAdded((s)    => { const n = new Set(s); names.forEach((x) => n.add(x)); return n; });
    setMsg(`Added ${toAdd.length} leads to your CRM.`);
  }

  async function saveAuto(next) {
    setAuto(next);
    await supabase.from('app_orgs').update({ autogen: next }).eq('id', orgId);
    setAutoMsg('Saved'); setTimeout(() => setAutoMsg(''), 1800);
  }

  async function runAutoNow() {
    setAutoMsg('Running…');
    const { data: { session } } = await supabase.auth.getSession();
    const res  = await fetch(`${SUPA_URL}/functions/v1/autogen-run`, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` }, body: '{}' });
    const data = await res.json();
    const cnt  = (data.summary || []).reduce((s, x) => s + (x.added || 0), 0);
    setAutoMsg(data.success ? `Added ${cnt} new leads` : ('Error: ' + (data.error || 'failed')));
    loadOrg();
  }

  const hasAiScores    = results.some((l) => l.ai_score !== undefined);
  const hasGenuine     = results.some((l) => l.genuine !== undefined);
  const genuineCount   = results.filter((l) => l.genuine === 'GENUINE').length;
  const riskyCount     = results.filter((l) => l.genuine === 'RISKY').length;
  let   displayResults = hotOnly && hasAiScores ? results.filter((l) => (l.ai_score || 0) >= 65) : results;
  if (genuineOnly && hasGenuine) displayResults = displayResults.filter((l) => l.genuine === 'GENUINE' || l.genuine === 'LIKELY');
  const newCount       = displayResults.filter((l) => !existing.has(l.company.toLowerCase())).length;
  const hotCount       = results.filter((l) => (l.ai_score || 0) >= 80).length;
  const warmCount      = results.filter((l) => (l.ai_score || 0) >= 65 && (l.ai_score || 0) < 80).length;
  const coldCount      = results.filter((l) => l.ai_score !== undefined && (l.ai_score || 0) < 65).length;
  const scanLabel      = SOURCES.find((s) => s.id === scanning)?.label || '';
  const sourceColors   = { Clearbit:'#6366f1', GitHub:'#0f172a', Maps:'#EA4335', Apollo:'#5C4EE5', OSM:'#22c55e', Registry:'#0369a1', 'Hunter.io':'#f59e0b', 'AI Scoring':'#7c3aed' };

  const hotStyle  = { bg:'#fef2f2', text:'#dc2626', border:'#fca5a5' };
  const warmStyle = { bg:'#fffbeb', text:'#d97706', border:'#fcd34d' };
  const coldStyle = { bg:'#f8fafc', text:'#94a3b8', border:'#e2e8f0' };
  function levelStyle(score) { return score >= 80 ? hotStyle : score >= 65 ? warmStyle : coldStyle; }
  function levelLabel(score) { return score >= 80 ? 'HOT' : score >= 65 ? 'WARM' : 'COLD'; }

  const genuineStyles = {
    GENUINE:    { bg:'#ecfdf5', text:'#047857', border:'#6ee7b7', icon:'✓' },
    LIKELY:     { bg:'#eff6ff', text:'#1d4ed8', border:'#93c5fd', icon:'~' },
    UNVERIFIED: { bg:'#f8fafc', text:'#64748b', border:'#e2e8f0', icon:'?' },
    RISKY:      { bg:'#fef2f2', text:'#b91c1c', border:'#fca5a5', icon:'!' },
  };

  return (
    <Page title="Lead Generator">

      {/* ── Search panel ────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-body" style={{ paddingTop:20 }}>

          <div style={{ marginBottom:18 }}>
            <h3 style={{ fontSize:17, fontWeight:800, marginBottom:4 }}>AI-powered lead discovery</h3>
            <p style={{ fontSize:13, color:'var(--muted)', margin:0 }}>
              7 live sources · Claude AI ranks every result HOT / WARM / COLD by fit for IT services outreach
            </p>
          </div>

          {/* Presets */}
          <div style={{ marginBottom:16 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Industry presets</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {PRESETS.map((p) => {
                const active = query === p.q;
                return (
                  <button key={p.q} type="button" className="sugg-chip"
                    style={{ fontSize:12, padding:'5px 13px', fontWeight:700, background: active ? '#e0e7ff' : undefined, color: active ? '#4338ca' : undefined, borderColor: active ? '#818cf8' : undefined }}
                    onClick={() => setQuery(active ? '' : p.q)}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Search row */}
          <div style={{ display:'flex', gap:10, marginBottom:14, flexWrap:'wrap' }}>
            <input style={{ flex:2, minWidth:220, padding:'10px 13px', border:'1.5px solid var(--border)', borderRadius:9, outline:'none' }}
              placeholder='e.g. "marketing agency London" or "dental clinic"'
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && generate()} />
            <input style={{ flex:1, minWidth:150, padding:'10px 13px', border:'1.5px solid var(--border)', borderRadius:9, outline:'none' }}
              placeholder="City (for Maps / OSM)"
              value={location} onChange={(e) => setLocation(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && generate()} />
            <button className="btn btn-primary" style={{ minWidth:140, height:42, fontSize:14 }}
              disabled={busy || !query.trim()} onClick={generate}>
              {busy ? 'Searching…' : 'Find Leads'}
            </button>
          </div>

          {/* Source toggles */}
          <div style={{ border:'1px solid var(--border)', borderRadius:11, overflow:'hidden', marginBottom:14 }}>
            {SOURCES.map((s, i) => {
              const hasKey = s.free || (s.id === 'maps' && mapsKey) || (s.id === 'apollo' && apolloKey) || (s.id === 'hunter' && hunterKey) || (s.id === 'ai' && anthropicKey);
              const needsKey = !s.free && !hasKey;
              return (
                <label key={s.id} style={{
                  display:'flex', flexDirection:'column', gap:3, padding:'9px 14px',
                  cursor: needsKey ? 'default' : 'pointer',
                  borderBottom: i < SOURCES.length - 1 ? '1px solid var(--border)' : 'none',
                  background: enabled[s.id] && hasKey ? s.color + '08' : undefined, transition:'background .15s',
                }}>
                  <div style={{ display:'flex', alignItems:'center', gap:8 }}>
                    <input type="checkbox" checked={enabled[s.id] && hasKey} disabled={needsKey} style={{ accentColor: s.color }}
                      onChange={(e) => setEnabled((x) => ({ ...x, [s.id]: e.target.checked }))} />
                    <span style={{ fontWeight:700, fontSize:13, color: hasKey && enabled[s.id] ? s.color : 'var(--muted)' }}>{s.label}</span>
                    {!s.free ? (
                      <span style={{ fontSize:10, fontWeight:700, padding:'1px 7px', borderRadius:20, background: hasKey ? '#f0fdf4' : '#fef3c7', color: hasKey ? '#15803d' : '#92400e' }}>
                        {hasKey ? 'Key set' : 'API key needed'}
                      </span>
                    ) : (
                      <span style={{ fontSize:10, color:'var(--muted)', fontWeight:500 }}>Free</span>
                    )}
                  </div>
                  <span style={{ fontSize:11, color:'var(--muted)', paddingLeft:22 }}>{s.desc}</span>
                </label>
              );
            })}
          </div>

          {/* API Keys panel */}
          <div style={{ border:'1.5px dashed var(--border)', borderRadius:11, overflow:'hidden', marginBottom: busy || results.length ? 14 : 0 }}>
            <button type="button"
              style={{ width:'100%', padding:'11px 16px', display:'flex', justifyContent:'space-between', alignItems:'center', background:'none', border:'none', cursor:'pointer', color:'var(--text)' }}
              onClick={() => setShowKeys((x) => !x)}>
              <span style={{ fontWeight:700, fontSize:13 }}>API Keys — unlock AI scoring, Maps, Apollo & Hunter</span>
              <span style={{ fontSize:11, color:'var(--muted)' }}>{showKeys ? 'Collapse' : 'Set up'}</span>
            </button>
            {showKeys && (
              <div style={{ borderTop:'1px solid var(--border)', padding:'16px' }}>

                {/* Anthropic — highlighted at top */}
                <div style={{ background:'linear-gradient(135deg,#f5f3ff,#ede9fe)', border:'1.5px solid #c4b5fd', borderRadius:10, padding:'14px', marginBottom:14 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:8 }}>
                    <span style={{ fontWeight:800, fontSize:13, color:'#6d28d9' }}>Anthropic API Key — AI Lead Scoring</span>
                    <a href="https://console.anthropic.com/keys" target="_blank" rel="noreferrer" style={{ color:'#7c3aed', fontSize:11, fontWeight:700 }}>Get free key →</a>
                  </div>
                  <input type="password" value={anthropicKey} placeholder="sk-ant-api03-…"
                    style={{ width:'100%', padding:'9px 12px', border:'1.5px solid #c4b5fd', borderRadius:8, outline:'none', fontSize:13, boxSizing:'border-box' }}
                    onChange={(e) => setAnthropicKey(e.target.value)}
                    onBlur={(e) => saveApiKey('anthropic_key', e.target.value)} />
                  {keySaved === 'anthropic_key' && <div style={{ fontSize:11, color:'#7c3aed', marginTop:4 }}>Saved</div>}
                  <div style={{ fontSize:11, color:'#6d28d9', marginTop:6, lineHeight:1.5 }}>
                    After every search, Claude analyzes all companies and ranks them HOT / WARM / COLD based on how likely they are to hire IT services. Free $5 credit on signup — enough for hundreds of searches.
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr', gap:12 }}>
                  <div className="field" style={{ marginBottom:0 }}>
                    <label style={{ display:'flex', justifyContent:'space-between' }}>
                      <span>Google Maps</span>
                      <a href="https://console.cloud.google.com/apis/library/places-backend.googleapis.com" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', fontSize:11, fontWeight:600 }}>Get key</a>
                    </label>
                    <input type="password" value={mapsKey} placeholder="AIza…" onChange={(e) => setMapsKey(e.target.value)} onBlur={(e) => saveApiKey('maps_key', e.target.value)} />
                    {keySaved === 'maps_key' && <div style={{ fontSize:11, color:'var(--green)', marginTop:3 }}>Saved</div>}
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, lineHeight:1.4 }}>Real phone numbers.</div>
                  </div>
                  <div className="field" style={{ marginBottom:0 }}>
                    <label style={{ display:'flex', justifyContent:'space-between' }}>
                      <span>Apollo.io</span>
                      <a href="https://app.apollo.io/#/settings/integrations/api" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', fontSize:11, fontWeight:600 }}>Get key</a>
                    </label>
                    <input type="password" value={apolloKey} placeholder="Apollo key…" onChange={(e) => setApolloKey(e.target.value)} onBlur={(e) => saveApiKey('apollo_key', e.target.value)} />
                    {keySaved === 'apollo_key' && <div style={{ fontSize:11, color:'var(--green)', marginTop:3 }}>Saved</div>}
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, lineHeight:1.4 }}>B2B contacts.</div>
                  </div>
                  <div className="field" style={{ marginBottom:0 }}>
                    <label style={{ display:'flex', justifyContent:'space-between' }}>
                      <span>Hunter.io</span>
                      <a href="https://hunter.io/api-keys" target="_blank" rel="noreferrer" style={{ color:'var(--primary)', fontSize:11, fontWeight:600 }}>Get key</a>
                    </label>
                    <input type="password" value={hunterKey} placeholder="Hunter key…" onChange={(e) => setHunterKey(e.target.value)} onBlur={(e) => saveApiKey('hunter_key', e.target.value)} />
                    {keySaved === 'hunter_key' && <div style={{ fontSize:11, color:'var(--green)', marginTop:3 }}>Saved</div>}
                    <div style={{ fontSize:11, color:'var(--muted)', marginTop:3, lineHeight:1.4 }}>Verified emails.</div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Progress */}
          {busy && (
            <div style={{ marginTop:14 }}>
              <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, color:'var(--muted)', marginBottom:5 }}>
                <span style={{ fontWeight:600 }}>
                  {scanning === 'ai' ? 'Claude AI analyzing companies…'
                    : scanning === 'verify' ? 'Verifying leads are genuine — DNS, email deliverability, domain age…'
                    : scanLabel ? `Scanning ${scanLabel}…` : 'Finishing…'}
                </span>
                <span>{pct}%</span>
              </div>
              <div style={{ height:5, background:'var(--border)', borderRadius:99, overflow:'hidden' }}>
                <div style={{ height:'100%', borderRadius:99, transition:'width .5s ease',
                  background: scanning === 'ai' ? 'linear-gradient(90deg,#7c3aed,#a78bfa)' : 'linear-gradient(90deg,#6366f1,#22c55e)',
                  width:`${pct}%` }} />
              </div>
              {results.length > 0 && scanning !== 'ai' && (
                <div style={{ fontSize:12, color:'var(--muted)', marginTop:5 }}>{results.length} results so far — more loading…</div>
              )}
              {scanning === 'ai' && (
                <div style={{ fontSize:12, color:'#7c3aed', marginTop:5, fontWeight:600 }}>
                  Found {results.length} companies — AI is reading each one and scoring their need for IT services…
                </div>
              )}
            </div>
          )}

          {msg && (
            <div className={`alert ${msg.startsWith('Added') || msg.startsWith('All') ? 'alert-ok' : 'alert-error'}`} style={{ marginTop:14, marginBottom:0 }}>
              {msg}
            </div>
          )}
        </div>
      </div>

      {/* ── Results ─────────────────────────────────────────────── */}
      {results.length > 0 && (
        <div style={{ marginBottom:18 }}>

          {/* Results header + filter */}
          <div style={{ display:'flex', gap:10, alignItems:'center', flexWrap:'wrap', marginBottom:12 }}>
            <div style={{ fontSize:13, color:'var(--muted)' }}>
              <b style={{ color:'var(--text)' }}>{results.length}</b> companies found
              {hasAiScores && (
                <>
                  {hotCount  > 0 && <> · <span style={{ color:'#dc2626',  fontWeight:800 }}>{hotCount} HOT</span></>}
                  {warmCount > 0 && <> · <span style={{ color:'#d97706',  fontWeight:800 }}>{warmCount} WARM</span></>}
                  {coldCount > 0 && <> · <span style={{ color:'#94a3b8',  fontWeight:600 }}>{coldCount} cold</span></>}
                </>
              )}
              {hasGenuine && (
                <>
                  {genuineCount > 0 && <> · <span style={{ color:'#047857', fontWeight:800 }}>✓ {genuineCount} genuine</span></>}
                  {riskyCount   > 0 && <> · <span style={{ color:'#b91c1c', fontWeight:700 }}>{riskyCount} risky</span></>}
                </>
              )}
            </div>
            <div style={{ marginLeft:'auto', display:'flex', gap:8, alignItems:'center' }}>
              {hasGenuine && (
                <label style={{ fontSize:12, display:'flex', gap:5, alignItems:'center', cursor:'pointer', padding:'5px 10px', borderRadius:7, border:'1.5px solid var(--border)', background: genuineOnly ? '#ecfdf5' : undefined }}>
                  <input type="checkbox" checked={genuineOnly} onChange={(e) => setGenuineOnly(e.target.checked)} style={{ accentColor:'#059669' }} />
                  <span style={{ fontWeight:700, color: genuineOnly ? '#047857' : 'var(--muted)' }}>Genuine only</span>
                </label>
              )}
              {hasAiScores && (
                <label style={{ fontSize:12, display:'flex', gap:5, alignItems:'center', cursor:'pointer', padding:'5px 10px', borderRadius:7, border:'1.5px solid var(--border)', background: hotOnly ? '#fef2f2' : undefined }}>
                  <input type="checkbox" checked={hotOnly} onChange={(e) => setHotOnly(e.target.checked)} style={{ accentColor:'#dc2626' }} />
                  <span style={{ fontWeight:700, color: hotOnly ? '#dc2626' : 'var(--muted)' }}>Hot leads only</span>
                </label>
              )}
              {newCount > 0 && (
                <button className="btn btn-primary btn-sm" onClick={addAll}>+ Add all {newCount}</button>
              )}
            </div>
          </div>

          <div className="gen-grid">
            {displayResults.map((l, i) => {
              const key          = l.company.toLowerCase();
              const inCrm        = existing.has(key);
              const justAdded    = added.has(key);
              const domain       = (l.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
              const suggs        = guessEmails(l.website);
              const chosen       = emailMap[key];
              const hunter       = hunterMap[key];
              const displayEmail = chosen || hunter?.email || l.email || '';
              const isVerified   = !!hunter;
              const srcColor     = sourceColors[l._source] || '#6366f1';
              const aiScore      = l.ai_score;
              const lvlStyle     = aiScore !== undefined ? levelStyle(aiScore) : null;
              const lvlLabel     = aiScore !== undefined ? levelLabel(aiScore) : null;

              return (
                <div key={`${l.company}-${i}`} className={`gen-card ${inCrm ? 'gen-card-added' : ''}`}
                  style={{ display:'flex', flexDirection:'column', borderTop: lvlStyle ? `3px solid ${lvlStyle.border}` : undefined }}>

                  {/* HOT/WARM/COLD + Genuine banner */}
                  {(lvlLabel || l.genuine) && (
                    <div style={{ display:'flex', alignItems:'center', gap:6, marginBottom:8, flexWrap:'wrap' }}>
                      {l.genuine && (() => {
                        const g = genuineStyles[l.genuine] || genuineStyles.UNVERIFIED;
                        return (
                          <span title={(l.genuine_reasons || []).join('\n')}
                            style={{ fontSize:10, fontWeight:900, letterSpacing:'.05em', padding:'2px 9px', borderRadius:20, background:g.bg, color:g.text, border:`1px solid ${g.border}`, cursor:'help' }}>
                            {g.icon} {l.genuine} {l.genuine_score}
                          </span>
                        );
                      })()}
                      {lvlLabel && (
                        <>
                          <span style={{ fontSize:10, fontWeight:900, letterSpacing:'.08em', padding:'2px 9px', borderRadius:20, background: lvlStyle.bg, color: lvlStyle.text, border:`1px solid ${lvlStyle.border}` }}>
                            {lvlLabel}
                          </span>
                          <span style={{ fontSize:11, fontWeight:700, color: lvlStyle.text }}>{aiScore}/100</span>
                        </>
                      )}
                      {l.ai_signals?.slice(0, 2).map((s) => (
                        <span key={s} style={{ fontSize:9, padding:'1px 6px', borderRadius:20, background:'var(--border)', color:'var(--muted)', fontWeight:700 }}>{s}</span>
                      ))}
                    </div>
                  )}

                  {/* Header */}
                  <div style={{ display:'flex', alignItems:'flex-start', gap:10, marginBottom:8 }}>
                    {l.logo || l.avatar ? (
                      <img src={l.logo || l.avatar} alt={l.company} style={{ width:36, height:36, borderRadius:8, objectFit:'cover', border:'1.5px solid var(--border)', flexShrink:0 }} />
                    ) : (
                      <CoAvatar company={l.company} size={36} />
                    )}
                    <div style={{ flex:1, minWidth:0 }}>
                      <div style={{ fontWeight:800, fontSize:14, lineHeight:1.2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.company}</div>
                      <div style={{ fontSize:11, color:'var(--muted)', marginTop:2, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>
                        {l.contact || l.industry || l.category || 'Business'}
                      </div>
                    </div>
                    {l._source && (
                      <span style={{ fontSize:9, fontWeight:800, color:srcColor, background:srcColor+'18', padding:'1px 6px', borderRadius:20, flexShrink:0 }}>{l._source}</span>
                    )}
                  </div>

                  {/* AI reason */}
                  {l.ai_reason && (
                    <div style={{ fontSize:11, color:'#6d28d9', background:'#f5f3ff', borderRadius:7, padding:'6px 9px', marginBottom:8, lineHeight:1.45, borderLeft:'2px solid #c4b5fd' }}>
                      {l.ai_reason}
                    </div>
                  )}

                  {l.website && (
                    <div style={{ fontSize:12, marginBottom:5 }}>
                      <a href={l.website.startsWith('http') ? l.website : 'https://' + l.website} target="_blank" rel="noreferrer" style={{ color:'var(--primary)' }}>{domain}</a>
                    </div>
                  )}
                  {l.phone && <div style={{ fontSize:12, fontWeight:700, color:'var(--text)', marginBottom:4 }}>{l.phone}</div>}
                  {l.rating && (
                    <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>
                      {'★'.repeat(Math.round(l.rating))}{'☆'.repeat(5 - Math.round(l.rating))} {l.rating}{l.ratingCount ? ` (${l.ratingCount})` : ''}
                    </div>
                  )}
                  {l.registered && <div style={{ fontSize:11, color:'var(--muted)', marginBottom:4 }}>Inc. {l.registered}{l.companyNumber ? ` · #${l.companyNumber}` : ''}</div>}

                  {/* Email */}
                  <div style={{ marginBottom:6 }}>
                    {displayEmail ? (
                      <div style={{ fontSize:12, display:'flex', alignItems:'center', gap:5, flexWrap:'wrap' }}>
                        {isVerified && <span style={{ fontSize:9, fontWeight:800, color:'#f59e0b', background:'#fef3c7', padding:'2px 7px', borderRadius:20, flexShrink:0 }}>Hunter {hunter.confidence}%</span>}
                        <span style={{ color: isVerified ? '#d97706' : chosen ? '#6366f1' : 'var(--muted)', wordBreak:'break-all' }}>{displayEmail}</span>
                        {suggs.length > 0 && (
                          <button type="button" style={{ fontSize:10, color:'var(--muted)', background:'none', border:'none', cursor:'pointer', padding:0, textDecoration:'underline', flexShrink:0 }} onClick={() => setShowSugg(showSugg === key ? '' : key)}>change</button>
                        )}
                      </div>
                    ) : suggs.length > 0 ? (
                      <button type="button" className="find-email-btn" onClick={() => setShowSugg(showSugg === key ? '' : key)}>Find email</button>
                    ) : null}
                    {showSugg === key && suggs.length > 0 && (
                      <div style={{ display:'flex', flexWrap:'wrap', gap:3, marginTop:5 }}>
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

                  {l.country && <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{l.country}</div>}
                  {l.address && <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6, lineHeight:1.4 }}>{l.address}</div>}
                  {l._oc_url && <div style={{ fontSize:11, marginBottom:6 }}><a href={l._oc_url} target="_blank" rel="noreferrer" style={{ color:'var(--primary)' }}>View registry filing</a></div>}

                  <div style={{ marginTop:'auto' }}>
                    {inCrm ? (
                      <div style={{ fontSize:12, fontWeight:700, color: justAdded ? '#22c55e' : '#94a3b8', paddingTop:4 }}>
                        {justAdded ? 'Added to CRM' : 'Already in CRM'}
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

      {/* ── Auto-pilot ──────────────────────────────────────────── */}
      <div className="card">
        <div className="card-head">
          <h3>Auto-pilot — daily lead discovery</h3>
          {autoMsg && <span style={{ fontSize:12, color:'#22c55e', fontWeight:700 }}>{autoMsg}</span>}
        </div>
        <div className="card-body">
          <label style={{ display:'flex', gap:12, cursor:'pointer', alignItems:'flex-start', marginBottom:18, padding:'12px 14px', background: auto.enabled ? '#f0fdf4' : 'var(--bg)', border:`1.5px solid ${auto.enabled ? '#86efac' : 'var(--border)'}`, borderRadius:10, transition:'all .15s' }}>
            <input type="checkbox" checked={auto.enabled} style={{ marginTop:2, accentColor:'#22c55e', flexShrink:0 }} onChange={(e) => saveAuto({ ...auto, enabled: e.target.checked })} />
            <div>
              <div style={{ fontWeight:700, fontSize:14, color: auto.enabled ? '#15803d' : 'var(--text)', marginBottom:2 }}>{auto.enabled ? 'Auto-pilot is ON' : 'Enable auto-pilot'}</div>
              <div style={{ fontSize:12, color:'var(--muted)', lineHeight:1.5 }}>Every day at 08:00 UTC, new leads matching your criteria are found and added automatically. Duplicates are always skipped.</div>
            </div>
          </label>

          <div style={{ marginBottom:14 }}>
            <div style={{ fontSize:11, fontWeight:700, color:'var(--muted)', textTransform:'uppercase', letterSpacing:'.05em', marginBottom:8 }}>Target industry</div>
            <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
              {PRESETS.map((p) => {
                const active = auto.keyword === p.q;
                return (
                  <button key={p.q} type="button" className="sugg-chip"
                    style={{ fontSize:11, padding:'4px 10px', background: active ? '#e0e7ff' : undefined, color: active ? '#4338ca' : undefined, borderColor: active ? '#818cf8' : undefined }}
                    onClick={() => saveAuto({ ...auto, keyword: p.q })}>
                    {p.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid2">
            <div className="field">
              <label>Custom keyword</label>
              <input value={auto.keyword} placeholder="marketing agency, dental clinic…" onChange={(e) => setAuto({ ...auto, keyword: e.target.value })} onBlur={() => saveAuto(auto)} />
            </div>
            <div className="field">
              <label>City / region</label>
              <input value={auto.location} placeholder="London, UK" onChange={(e) => setAuto({ ...auto, location: e.target.value })} onBlur={() => saveAuto(auto)} />
            </div>
          </div>

          <div className="field" style={{ marginBottom:16 }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
              <label style={{ margin:0 }}>Leads per day</label>
              <b style={{ fontSize:13, color:'#6366f1' }}>{auto.daily_limit}</b>
            </div>
            <input type="range" min="1" max="30" value={auto.daily_limit} style={{ width:'100%', accentColor:'#6366f1' }} onChange={(e) => setAuto({ ...auto, daily_limit: Number(e.target.value) })} onMouseUp={() => saveAuto(auto)} />
            <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--muted)', marginTop:2 }}>
              <span>1 / day</span><span>15 / day</span><span>30 / day</span>
            </div>
          </div>

          <div style={{ display:'flex', gap:10, alignItems:'center' }}>
            <button className="btn btn-primary btn-sm" onClick={runAutoNow} disabled={!auto.keyword || autoMsg === 'Running…'}>Run now</button>
            <span style={{ fontSize:12, color:'var(--muted)' }}>Test immediately without waiting for tomorrow's scheduled run.</span>
          </div>
        </div>
      </div>
    </Page>
  );
}
