import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill, CoAvatar } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';
import { guessEmails, guessFirstEmail } from '../../lib/emailGuess';

const STATUSES  = ['New Lead','Contacted','Qualified','Proposal Sent','Negotiation','Closed Won','Closed Lost'];
const PAGE_SIZE = 25;
const BLANK = { company:'', contact:'', email:'', website:'', industry:'', country:'', category:'', lead_score:50, opportunity_size:'', status:'New Lead', notes:'' };
const DEMO  = [
  { company:'Samsara',   contact:'Sanjit Biswas',  email:'sanjit@samsara.com', category:'IoT',  industry:'Fleet Tech',      country:'USA', lead_score:92, opportunity_size:'$50K–$200K' },
  { company:'Tempus AI', contact:'Eric Lefkofsky', email:'eric@tempus.com',    category:'AI/ML',industry:'HealthTech',       country:'USA', lead_score:88, opportunity_size:'$80K–$300K' },
  { company:'Zendesk',   contact:'Tom Eggemeier',  email:'tom@zendesk.com',    category:'SaaS', industry:'Customer Support', country:'USA', lead_score:79, opportunity_size:'$40K–$160K' },
];
const STATUS_STYLE = {
  'New Lead':      { background:'#eff6ff', color:'#1d4ed8' },
  'Contacted':     { background:'#fef9c3', color:'#854d0e' },
  'Qualified':     { background:'#f3e8ff', color:'#6b21a8' },
  'Proposal Sent': { background:'#fae8ff', color:'#a21caf' },
  'Negotiation':   { background:'#fff7ed', color:'#c2410c' },
  'Closed Won':    { background:'#dcfce7', color:'#166534' },
  'Closed Lost':   { background:'#fee2e2', color:'#991b1b' },
};
const QUICK_FILTERS = [
  { id:'all',     label:'All' },
  { id:'email',   label:'✉️ Has Email' },
  { id:'phone',   label:'📞 Has Phone' },
  { id:'nosite',  label:'🌐 No Website' },
  { id:'hot',     label:'🔥 Hot (≥70)' },
  { id:'unsent',  label:'📬 Not Emailed' },
  { id:'replied', label:'↩ Replied' },
];

function parsePhoneFromNotes(notes) {
  const m = (notes || '').match(/^Phone:\s*(.+)/m);
  return m ? m[1].trim() : '';
}
function parseLinkedinFromNotes(notes) {
  const m = (notes || '').match(/^LinkedIn:\s*(.+)/m);
  return m ? m[1].trim() : '';
}
function stripMetaFromNotes(notes) {
  return (notes || '').replace(/^Phone:.*\n?/m, '').replace(/^LinkedIn:.*\n?/m, '').trim();
}

// CSV parser that handles quoted fields
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return { headers: [], rows: [] };
  const headers = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, ''));
  const rows = lines.slice(1).map((line) => {
    const vals = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { vals.push(cur.trim()); cur = ''; }
      else { cur += c; }
    }
    vals.push(cur.trim());
    return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
  });
  return { headers, rows };
}

const LEAD_FIELDS = ['company','contact','email','website','industry','category','country','lead_score','opportunity_size','status','notes'];

export default function Leads() {
  const { orgId } = useAuth();
  const [leads,       setLeads]       = useState([]);
  const [loading,     setLoading]     = useState(true);
  const [q,           setQ]           = useState('');
  const [fStatus,     setFStatus]     = useState('');
  const [fQuick,      setFQuick]      = useState('all');
  const [sortBy,      setSortBy]      = useState('score');
  const [selected,    setSelected]    = useState(new Set());
  const [edit,        setEdit]        = useState(null);
  const [compose,     setCompose]     = useState(null);
  const [draft,       setDraft]       = useState({ subject:'', body:'' });
  const [angle,       setAngle]       = useState('');
  const [emailTab,    setEmailTab]    = useState('edit'); // 'edit' | 'preview'
  const [sending,     setSending]     = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProg,    setBulkProg]    = useState({ done:0, total:0, current:'' });
  const [detailLead,  setDetailLead]  = useState(null);
  const [detailNote,  setDetailNote]  = useState('');
  const [savingNote,  setSavingNote]  = useState(false);
  const [savingStatus,setSavingStatus]= useState(null);
  const [toast,       setToast]       = useState('');
  const [page,        setPage]        = useState(1);
  // CSV import
  const [importData,  setImportData]  = useState(null); // { headers, rows, mapping }
  const [importing,   setImporting]   = useState(false);
  const [confirmLead, setConfirmLead] = useState(null);
  const [confirming,  setConfirming]  = useState(false);
  const [sendAllOpen, setSendAllOpen] = useState(false);
  const [sendAllMode, setSendAllMode] = useState('unsent'); // 'unsent' | 'all'
  const [sendAllProg, setSendAllProg] = useState({ running:false, done:0, total:0, current:'', errors:0 });
  const [emailSuggs,  setEmailSuggs]  = useState([]);
  const [editPhone,   setEditPhone]   = useState('');
  const [editLinkedin,setEditLinkedin]= useState('');
  const [enriching,   setEnriching]   = useState(false);
  const fileRef = useRef();

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('app_leads').select('*').order('created_at', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);
  useEffect(() => { setPage(1); }, [q, fStatus, fQuick, sortBy]);

  const filtered = useMemo(() => {
    let rows = leads.filter((l) => {
      const s = (q || '').toLowerCase();
      const hit = !s || [l.company, l.contact, l.email, l.category, l.country].some((v) => (v||'').toLowerCase().includes(s));
      if (!hit) return false;
      if (fStatus && l.status !== fStatus) return false;
      if (fQuick === 'email')   return l.email && l.email !== '';
      if (fQuick === 'phone')   return !!extractPhone(l.notes);
      if (fQuick === 'nosite')  return !l.website || l.website === '';
      if (fQuick === 'hot')     return (l.lead_score||0) >= 70;
      if (fQuick === 'unsent')  return !l.email_sent;
      if (fQuick === 'replied') return !!l.email_replied;
      return true;
    });
    if (sortBy === 'score')   rows = [...rows].sort((a,b) => (b.lead_score||0) - (a.lead_score||0));
    if (sortBy === 'company') rows = [...rows].sort((a,b) => (a.company||'').localeCompare(b.company||''));
    if (sortBy === 'country') rows = [...rows].sort((a,b) => (a.country||'').localeCompare(b.country||''));
    if (sortBy === 'newest')  rows = [...rows].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [leads, q, fStatus, fQuick, sortBy]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = useMemo(() => ({
    email:   leads.filter((l) => l.email && l.email !== '').length,
    phone:   leads.filter((l) => !!extractPhone(l.notes)).length,
    nosite:  leads.filter((l) => !l.website || l.website === '').length,
    hot:     leads.filter((l) => (l.lead_score||0) >= 70).length,
    unsent:  leads.filter((l) => !l.email_sent).length,
    replied: leads.filter((l) => !!l.email_replied).length,
  }), [leads]);

  // ---------- helpers ----------
  function toast$(msg, ms = 3000) { setToast(msg); setTimeout(() => setToast(''), ms); }
  function toggleSelect(id) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll()       { setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((l) => l.id))); }

  function openDetail(l)  { setDetailLead(l); setDetailNote(l.notes || ''); }
  function openCompose(l) { const a = defaultAngle(l); setAngle(a); setCompose(l); setDraft(generateDraft(l, a)); setEmailTab('edit'); }
  function regen(a)       { const x = a ?? angle; setAngle(x); setDraft(generateDraft(compose, x)); }

  function openEdit(lead) {
    setEdit(lead);
    setEditPhone(parsePhoneFromNotes(lead.notes));
    setEditLinkedin(parseLinkedinFromNotes(lead.notes));
    setEmailSuggs(guessEmails(lead.website));
  }
  function closeEdit() {
    setEdit(null); setEditPhone(''); setEditLinkedin(''); setEmailSuggs([]);
  }

  async function doEnrich() {
    const toEnrich = leads.filter((l) => l.website && !l.email);
    if (!toEnrich.length) { toast$('All leads with websites already have emails'); return; }
    setEnriching(true);
    let count = 0;
    for (const l of toEnrich) {
      const email = guessFirstEmail(l.website);
      if (!email) continue;
      await supabase.from('app_leads').update({ email }).eq('id', l.id);
      count++;
    }
    setEnriching(false);
    toast$(`✅ Found ${count} emails using info@domain pattern`);
    load();
  }

  async function changeStatus(l, status) {
    setSavingStatus(l.id);
    await supabase.from('app_leads').update({ status }).eq('id', l.id);
    setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, status } : x));
    if (detailLead?.id === l.id) setDetailLead((d) => ({ ...d, status }));
    setSavingStatus(null);
  }

  async function markReplied(l) {
    await supabase.from('app_leads').update({ email_replied: true, status: 'Qualified' }).eq('id', l.id);
    setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, email_replied: true, status: 'Qualified' } : x));
    if (detailLead?.id === l.id) setDetailLead((d) => ({ ...d, email_replied: true, status: 'Qualified' }));
    toast$(`↩ ${l.company} marked as replied — status → Qualified`);
  }

  async function doConfirm(action) {
    if (!confirmLead) return;
    setConfirming(true);
    const updates = action === 'qualify'
      ? { status: 'Qualified', confirmed_at: new Date().toISOString() }
      : { status: 'Closed Lost' };
    await supabase.from('app_leads').update(updates).eq('id', confirmLead.id);
    setLeads((prev) => prev.map((x) => x.id === confirmLead.id ? { ...x, ...updates } : x));
    setConfirming(false);
    const msg = action === 'qualify'
      ? `✅ ${confirmLead.company} confirmed — moved to Qualified`
      : `❌ ${confirmLead.company} rejected — moved to Closed Lost`;
    toast$(msg);
    setConfirmLead(null);
  }

  async function bulkChangeStatus(status) {
    const ids = [...selected];
    await Promise.all(ids.map((id) => supabase.from('app_leads').update({ status }).eq('id', id)));
    setLeads((prev) => prev.map((l) => selected.has(l.id) ? { ...l, status } : l));
    setSelected(new Set());
    toast$(`✅ ${ids.length} leads moved to "${status}"`);
  }

  async function saveNote() {
    if (!detailNote.trim()) return;
    setSavingNote(true);
    await supabase.from('app_leads').update({ notes: detailNote }).eq('id', detailLead.id);
    setLeads((prev) => prev.map((x) => x.id === detailLead.id ? { ...x, notes: detailNote } : x));
    setDetailLead((d) => ({ ...d, notes: detailNote }));
    setSavingNote(false); toast$('✅ Notes saved', 2000);
  }

  function exportCSV() {
    const cols = ['company','contact','email','phone','website','industry','category','country','lead_score','status','opportunity_size'];
    const hdr  = cols.join(',');
    const rows = filtered.map((l) => cols.map((c) => {
      const v = c === 'phone' ? extractPhone(l.notes) : (l[c] || '');
      return `"${String(v).replace(/"/g, '""')}"`;
    }).join(','));
    const blob = new Blob([[hdr, ...rows].join('\n')], { type: 'text/csv' });
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `leads-${new Date().toISOString().split('T')[0]}.csv` });
    a.click(); URL.revokeObjectURL(a.href);
  }

  function onImportFile(e) {
    const file = e.target.files?.[0]; if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const { headers, rows } = parseCSV(ev.target.result);
      const mapping = {};
      headers.forEach((h) => {
        const key = h.toLowerCase().trim();
        const match = LEAD_FIELDS.find((f) => key === f || key.includes(f) || f.includes(key));
        if (match) mapping[match] = h;
      });
      setImportData({ headers, rows: rows.slice(0, 500), mapping });
    };
    reader.readAsText(file);
    e.target.value = '';
  }

  async function doImport() {
    if (!importData) return;
    setImporting(true);
    const { rows, mapping } = importData;
    const records = rows.filter((r) => r[mapping.company]).map((r) => ({
      org_id:           orgId,
      company:          r[mapping.company]          || '',
      contact:          r[mapping.contact]          || '',
      email:            r[mapping.email]            || '',
      website:          r[mapping.website]          || '',
      industry:         r[mapping.industry]         || '',
      category:         r[mapping.category]         || '',
      country:          r[mapping.country]          || '',
      lead_score:       Number(r[mapping.lead_score]) || 50,
      opportunity_size: r[mapping.opportunity_size] || '',
      status:           STATUSES.includes(r[mapping.status]) ? r[mapping.status] : 'New Lead',
      notes:            r[mapping.notes]            || '',
    }));
    const CHUNK = 50;
    for (let i = 0; i < records.length; i += CHUNK) {
      await supabase.from('app_leads').insert(records.slice(i, i + CHUNK));
    }
    setImporting(false); setImportData(null);
    toast$(`✅ Imported ${records.length} leads`); load();
  }

  async function save(e) {
    e.preventDefault();
    const metaLines = [];
    if (editPhone.trim())    metaLines.push(`Phone: ${editPhone.trim()}`);
    if (editLinkedin.trim()) metaLines.push(`LinkedIn: ${editLinkedin.trim()}`);
    const baseNotes  = stripMetaFromNotes(edit.notes);
    const finalNotes = [...metaLines, baseNotes].filter(Boolean).join('\n');
    const payload = { ...edit, lead_score: Number(edit.lead_score) || 0, notes: finalNotes };
    if (edit.id) { const { id, ...rest } = payload; await supabase.from('app_leads').update(rest).eq('id', id); }
    else          await supabase.from('app_leads').insert({ ...payload, org_id: orgId });
    closeEdit(); load();
  }

  async function remove(l) {
    if (!confirm(`Delete "${l.company}"?`)) return;
    await supabase.from('app_leads').delete().eq('id', l.id);
    setSelected((s) => { const n = new Set(s); n.delete(l.id); return n; });
    load();
  }

  async function seedDemo() {
    await supabase.from('app_leads').insert(DEMO.map((d) => ({ ...d, org_id: orgId, status: 'New Lead' })));
    load();
  }

  async function doSend(e) {
    e.preventDefault(); setSending(true);
    try {
      await sendEmail({ to: compose.email, subject: draft.subject, html: draft.body });
      await supabase.from('app_leads').update({ email_sent: true, last_contact: new Date().toISOString(),
        status: compose.status === 'New Lead' ? 'Contacted' : compose.status }).eq('id', compose.id);
      setCompose(null); toast$(`✅ Email sent to ${compose.email}`); load();
    } catch (err) { alert('Send failed: ' + err.message); }
    finally { setSending(false); }
  }

  async function sendBulk() {
    const toSend = filtered.filter((l) => selected.has(l.id) && l.email);
    if (!toSend.length) { alert('None of the selected leads have an email address.'); return; }
    setBulkSending(true); setBulkProg({ done: 0, total: toSend.length, current: '' });
    for (const l of toSend) {
      setBulkProg((p) => ({ ...p, current: l.company }));
      const d = generateDraft(l, defaultAngle(l));
      try {
        await sendEmail({ to: l.email, subject: d.subject, html: d.body });
        await supabase.from('app_leads').update({ email_sent: true, last_contact: new Date().toISOString(),
          status: l.status === 'New Lead' ? 'Contacted' : l.status }).eq('id', l.id);
      } catch {}
      setBulkProg((p) => ({ ...p, done: p.done + 1 }));
    }
    setSelected(new Set()); setBulkSending(false);
    toast$(`✅ Sent emails to ${toSend.length} leads`); load();
  }

  async function sendAll() {
    const pool = leads.filter((l) => l.email && (sendAllMode === 'all' || !l.email_sent));
    if (!pool.length) { setSendAllOpen(false); return; }
    setSendAllProg({ running:true, done:0, total:pool.length, current:'', errors:0 });
    let errors = 0;
    for (const l of pool) {
      setSendAllProg((p) => ({ ...p, current: l.company }));
      const d = generateDraft(l, defaultAngle(l));
      try {
        await sendEmail({ to: l.email, subject: d.subject, html: d.body });
        await supabase.from('app_leads').update({
          email_sent: true, last_contact: new Date().toISOString(),
          status: l.status === 'New Lead' ? 'Contacted' : l.status,
        }).eq('id', l.id);
      } catch { errors++; }
      setSendAllProg((p) => ({ ...p, done: p.done + 1, errors }));
    }
    setSendAllProg((p) => ({ ...p, running: false }));
    load();
  }

  const sendAllPool = leads.filter((l) => l.email && (sendAllMode === 'all' || !l.email_sent));

  return (
    <Page title="Leads" actions={
      <>
        <input ref={fileRef} type="file" accept=".csv" style={{ display:'none' }} onChange={onImportFile} />
        <button className="btn btn-ghost btn-sm" onClick={() => fileRef.current?.click()} title="Import CSV">⬆️ Import</button>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} title="Export current view as CSV">⬇️ Export</button>
        <button className="btn btn-ghost btn-sm" onClick={seedDemo}>+ Demo</button>
        <button className="btn btn-sm" style={{ background:'#fef3c7', color:'#92400e', border:'1px solid #fde68a', fontWeight:700 }}
          onClick={() => { setSendAllMode('unsent'); setSendAllOpen(true); }}>
          📨 Send All
        </button>
        <button className="btn btn-ghost btn-sm" disabled={enriching} onClick={doEnrich} title="Fill info@domain email for leads that have a website but no email">
          {enriching ? '⏳ Finding…' : '🔍 Find emails'}
        </button>
        <button className="btn btn-primary btn-sm" onClick={() => openEdit({ ...BLANK })}>+ Add Lead</button>
      </>
    }>
      {toast && <div className="alert alert-ok" style={{ marginBottom:14 }}>{toast}</div>}

      {/* Search + filters */}
      <div className="toolbar" style={{ marginBottom:10 }}>
        <input placeholder="Search company, contact, email, country…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth:260 }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="score">Score ↓</option>
          <option value="newest">Newest</option>
          <option value="company">Company A–Z</option>
          <option value="country">Country A–Z</option>
        </select>
        <span style={{ color:'var(--muted)', fontSize:13, marginLeft:'auto' }}>
          {filtered.length === leads.length ? `${leads.length} leads` : `${filtered.length} of ${leads.length}`}
          {pageCount > 1 && ` · p${page}/${pageCount}`}
        </span>
      </div>

      <div className="filter-chips">
        {QUICK_FILTERS.map((f) => (
          <button key={f.id} className={`chip ${fQuick === f.id ? 'active' : ''}`} onClick={() => setFQuick(f.id)}>
            {f.label}{f.id !== 'all' && <span className="chip-count">{counts[f.id]}</span>}
          </button>
        ))}
        {(q || fStatus || fQuick !== 'all') && (
          <button className="chip" onClick={() => { setQ(''); setFStatus(''); setFQuick('all'); }} style={{ color:'var(--red)', borderColor:'#fecaca' }}>
            ✕ Clear
          </button>
        )}
      </div>

      <div className="card">
        <div className="card-body" style={{ padding:0, overflowX:'auto' }}>
          {loading ? (
            <div style={{ padding:24 }}>
              {[1,2,3,4,5].map((i) => <div key={i} className="skeleton" style={{ height:44, marginBottom:8, borderRadius:8 }} />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize:40, marginBottom:12 }}>🔍</div>
              <div style={{ fontWeight:600, marginBottom:6 }}>No leads match your filters</div>
              <div style={{ fontSize:13, color:'var(--muted)', marginBottom:16 }}>Try adjusting your search or clearing the filters</div>
              <button className="btn btn-ghost btn-sm" onClick={() => { setQ(''); setFStatus(''); setFQuick('all'); }}>Clear filters</button>
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th style={{ width:36, paddingRight:0 }}>
                    <input type="checkbox" checked={selected.size > 0 && selected.size === filtered.length} onChange={toggleAll} title="Select all" />
                  </th>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th style={{ textAlign:'center' }}>Score</th>
                  <th style={{ minWidth:160 }}></th>
                </tr>
              </thead>
              <tbody>
                {paginated.map((l) => {
                  const phone  = extractPhone(l.notes);
                  const domain = (l.website || '').replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
                  const style  = STATUS_STYLE[l.status] || {};
                  return (
                    <tr key={l.id} className={selected.has(l.id) ? 'row-selected' : ''}>
                      <td style={{ paddingRight:0 }}>
                        <input type="checkbox" checked={selected.has(l.id)} onChange={() => toggleSelect(l.id)} />
                      </td>
                      <td>
                        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
                          <CoAvatar company={l.company} size={32} />
                          <div style={{ minWidth:0 }}>
                            <button className="company-btn" onClick={() => openDetail(l)}>
                              <b style={{ fontSize:13 }}>{l.company}</b>
                            </button>
                            {(!l.website || l.website === '') ? (
                              <div style={{ fontSize:11, color:'#f59e0b', fontWeight:600 }}>No website</div>
                            ) : (
                              <div style={{ fontSize:11 }}>
                                <a href={l.website.startsWith('http') ? l.website : 'https://'+l.website} target="_blank" rel="noreferrer" style={{ color:'var(--primary)' }}>{domain}</a>
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td style={{ fontSize:13 }}>{l.contact || <span style={{ color:'var(--muted)' }}>—</span>}</td>
                      <td style={{ fontSize:12 }}>
                        {l.email ? <a href={`mailto:${l.email}`} style={{ color:'var(--primary)' }}>{l.email}</a> : <span style={{ color:'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize:12 }}>
                        {phone ? <a href={`tel:${phone}`} style={{ color:'var(--text)' }}>{phone}</a> : <span style={{ color:'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize:12 }}>{l.country || '—'}</td>
                      <td>
                        <select className="status-sel" value={l.status}
                          onChange={(e) => changeStatus(l, e.target.value)}
                          disabled={savingStatus === l.id} style={{ ...style }}>
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                        {l.email_sent    && <span style={{ fontSize:10, marginLeft:4 }} title="Email sent">✉️</span>}
                        {l.email_replied && <span style={{ fontSize:10, marginLeft:2 }} title="Replied">↩</span>}
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>{l.lead_score}</span>
                      </td>
                      <td style={{ whiteSpace:'nowrap' }}>
                        {l.status === 'New Lead' && (
                          <button className="btn btn-sm" style={{ background:'#f0f9ff', color:'#0369a1', border:'1px solid #bae6fd', marginRight:4, fontWeight:700 }}
                            onClick={() => setConfirmLead(l)} title="Review & confirm this lead">✓ Confirm</button>
                        )}
                        {l.status !== 'New Lead' && (l.email_sent && !l.email_replied ? (
                          <button className="btn btn-sm" style={{ background:'#f0fdf4', color:'#166534', marginRight:4 }}
                            onClick={() => markReplied(l)} title="Mark as replied">↩ Replied</button>
                        ) : (
                          <button className="btn btn-sm" style={{ background: l.email ? '#f0fdf4' : '#f8fafc', color: l.email ? '#166534' : '#94a3b8', minWidth:72, marginRight:4 }}
                            disabled={!l.email} onClick={() => openCompose(l)}>✍️ Email</button>
                        ))}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(l)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {pageCount > 1 && (
          <div className="pagination">
            <button className="page-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
            <button className="page-btn" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>‹</button>
            {Array.from({ length: Math.min(pageCount, 7) }, (_, i) => {
              const start = Math.max(1, Math.min(page - 3, pageCount - 6));
              const p = start + i;
              return p <= pageCount ? (
                <button key={p} className={`page-btn ${page === p ? 'active' : ''}`} onClick={() => setPage(p)}>{p}</button>
              ) : null;
            })}
            <button className="page-btn" disabled={page === pageCount} onClick={() => setPage((p) => p + 1)}>›</button>
            <button className="page-btn" disabled={page === pageCount} onClick={() => setPage(pageCount)}>»</button>
          </div>
        )}
      </div>

      {/* Floating bulk action bar */}
      {selected.size > 0 && (
        <div className="bulk-bar">
          <span style={{ fontSize:13, whiteSpace:'nowrap', fontWeight:700 }}>{selected.size} selected</span>
          <select className="btn btn-ghost btn-sm" style={{ color:'#cbd5e1', borderColor:'#334155', background:'#1e293b' }}
            defaultValue="" onChange={(e) => { if (e.target.value) { bulkChangeStatus(e.target.value); e.target.value = ''; } }}>
            <option value="" disabled>Move to…</option>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
          <button className="btn btn-primary btn-sm" onClick={sendBulk} disabled={bulkSending} style={{ minWidth:140 }}>
            {bulkSending ? `📨 ${bulkProg.done}/${bulkProg.total} — ${bulkProg.current}` : `📨 Email all ${selected.size}`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}>⬇️ CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>✕ Clear</button>
        </div>
      )}

      {/* Lead detail drawer */}
      {detailLead && (<>
        <div className="drawer-overlay" onClick={() => setDetailLead(null)} />
        <aside className="drawer">
          <div className="drawer-head">
            <div>
              <div style={{ fontWeight:800, fontSize:18 }}>{detailLead.company}</div>
              <div style={{ display:'flex', gap:8, marginTop:6, flexWrap:'wrap', alignItems:'center' }}>
                <span className={`score-badge ${detailLead.lead_score >= 80 ? 'hot' : detailLead.lead_score >= 60 ? 'warm' : 'cold'}`}>{detailLead.lead_score} pts</span>
                {!detailLead.website && <span style={{ fontSize:11, fontWeight:700, color:'#f59e0b', padding:'3px 8px', background:'#fef3c7', borderRadius:20 }}>No website</span>}
                {detailLead.email_replied && <span style={{ fontSize:11, fontWeight:700, color:'#166534', padding:'3px 8px', background:'#dcfce7', borderRadius:20 }}>↩ Replied</span>}
                {detailLead.opportunity_size && <span style={{ fontSize:11, color:'var(--muted)' }}>{detailLead.opportunity_size}</span>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setDetailLead(null)}>✕ Close</button>
          </div>

          <div className="drawer-body">
            <div className="drawer-actions">
              {detailLead.status === 'New Lead' && (
                <button className="btn btn-sm" style={{ background:'#f0f9ff', color:'#0369a1', border:'1px solid #bae6fd', fontWeight:700 }}
                  onClick={() => { setDetailLead(null); setConfirmLead(detailLead); }}>✓ Confirm Lead</button>
              )}
              <button className="btn btn-primary btn-sm" disabled={!detailLead.email}
                onClick={() => { setDetailLead(null); openCompose(detailLead); }}>✍️ Email</button>
              {detailLead.email_sent && !detailLead.email_replied && (
                <button className="btn btn-sm" style={{ background:'#f0fdf4', color:'#166534' }}
                  onClick={() => markReplied(detailLead)}>↩ Replied</button>
              )}
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setDetailLead(null); openEdit(detailLead); }}>✏️ Edit</button>
              <button className="btn btn-danger btn-sm"
                onClick={() => { setDetailLead(null); remove(detailLead); }}>🗑</button>
            </div>

            <div className="drawer-section">
              <div className="drawer-label">Contact</div>
              <div style={{ fontWeight:600, fontSize:14 }}>{detailLead.contact || '—'}</div>
              {detailLead.email && <div style={{ marginTop:4 }}><a href={`mailto:${detailLead.email}`} style={{ color:'var(--primary)', fontSize:13 }}>{detailLead.email}</a></div>}
              {extractPhone(detailLead.notes) && <div style={{ marginTop:2 }}><a href={`tel:${extractPhone(detailLead.notes)}`} style={{ fontSize:13 }}>📞 {extractPhone(detailLead.notes)}</a></div>}
            </div>

            <div className="drawer-section">
              <div className="drawer-label">Company</div>
              <div style={{ fontSize:13 }}>{[detailLead.industry, detailLead.category, detailLead.country].filter(Boolean).join(' · ')}</div>
              {detailLead.website && (
                <div style={{ marginTop:4 }}>
                  <a href={detailLead.website.startsWith('http') ? detailLead.website : 'https://'+detailLead.website}
                    target="_blank" rel="noreferrer" style={{ color:'var(--primary)', fontSize:13 }}>
                    🌐 {detailLead.website.replace(/^https?:\/\//, '')}
                  </a>
                </div>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-label">Status</div>
              <select className="status-sel" value={detailLead.status}
                onChange={(e) => changeStatus(detailLead, e.target.value)}
                style={{ ...(STATUS_STYLE[detailLead.status] || {}), padding:'5px 14px', fontSize:13 }}>
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {detailLead.email_sent && (
                <div style={{ marginTop:8, fontSize:12, color:'var(--muted)' }}>
                  ✉️ Emailed {detailLead.last_contact ? new Date(detailLead.last_contact).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''}
                  {detailLead.email_replied && <span style={{ color:'#22c55e', marginLeft:8, fontWeight:700 }}>· ↩ Replied</span>}
                </div>
              )}
            </div>

            <div className="drawer-section">
              <div className="drawer-label">Notes</div>
              <textarea rows={5} value={detailNote} onChange={(e) => setDetailNote(e.target.value)}
                style={{ width:'100%', border:'1.5px solid var(--border)', borderRadius:9, padding:'8px 10px', resize:'vertical', fontSize:13, lineHeight:1.5, background:'var(--bg)', color:'var(--text)' }} />
              <button className="btn btn-sm btn-primary" style={{ marginTop:8 }} onClick={saveNote} disabled={savingNote}>
                {savingNote ? 'Saving…' : '💾 Save notes'}
              </button>
            </div>

            <div style={{ fontSize:11, color:'var(--muted)', paddingTop:4 }}>
              Added {detailLead.created_at ? new Date(detailLead.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'}
              {detailLead.country && ` · ${detailLead.country}`}
            </div>
          </div>
        </aside>
      </>)}

      {/* Add / Edit modal — enhanced */}
      {edit && (() => {
        const dupWarning = !edit.id && edit.company.trim().length > 1
          && leads.some((l) => l.company.toLowerCase() === edit.company.trim().toLowerCase());
        const scoreColor = edit.lead_score >= 80 ? '#22c55e' : edit.lead_score >= 60 ? '#f59e0b' : '#94a3b8';
        const scoreLabel = edit.lead_score >= 80 ? 'Hot' : edit.lead_score >= 60 ? 'Warm' : 'Cold';
        return (
          <Modal title={edit.id ? `Edit — ${edit.company}` : '+ Add New Lead'} onClose={closeEdit}
            footer={<>
              <button className="btn btn-ghost" onClick={closeEdit}>Cancel</button>
              <button className="btn btn-primary" form="leadForm" style={{ minWidth:120 }}>
                {edit.id ? '💾 Save changes' : '➕ Add Lead'}
              </button>
            </>}>
            <form id="leadForm" onSubmit={save}>

              {dupWarning && (
                <div className="alert" style={{ background:'#fffbeb', color:'#92400e', border:'1px solid #fde68a', marginBottom:14, fontSize:13 }}>
                  ⚠️ A lead named <b>"{edit.company.trim()}"</b> already exists in your CRM.
                </div>
              )}

              {/* Row 1: Company + Website */}
              <div className="grid2">
                <div className="field">
                  <label>Company <span style={{ color:'#ef4444' }}>*</span></label>
                  <input required autoFocus value={edit.company}
                    onChange={(e) => setEdit({ ...edit, company: e.target.value })}
                    placeholder="Acme Corp" />
                </div>
                <div className="field">
                  <label>Website</label>
                  <input value={edit.website||''}
                    placeholder="acme.com"
                    onChange={(e) => {
                      const w = e.target.value;
                      setEdit({ ...edit, website: w });
                      setEmailSuggs(guessEmails(w));
                    }} />
                </div>
              </div>

              {/* Row 2: Contact + Email with suggestions */}
              <div className="grid2">
                <div className="field">
                  <label>Contact name</label>
                  <input value={edit.contact||''} placeholder="Jane Smith"
                    onChange={(e) => setEdit({ ...edit, contact: e.target.value })} />
                </div>
                <div className="field">
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <label style={{ margin:0 }}>Email</label>
                    {emailSuggs.length > 0 && !edit.email && (
                      <span style={{ fontSize:11, color:'var(--muted)' }}>Click to use →</span>
                    )}
                  </div>
                  <input type="email" value={edit.email||''} placeholder="info@acme.com"
                    onChange={(e) => setEdit({ ...edit, email: e.target.value })} />
                  {emailSuggs.length > 0 && (
                    <div style={{ display:'flex', flexWrap:'wrap', gap:4, marginTop:5 }}>
                      {emailSuggs.map((s) => (
                        <button key={s} type="button" className="sugg-chip"
                          style={{ background: edit.email === s ? '#e0e7ff' : undefined, color: edit.email === s ? '#4338ca' : undefined }}
                          onClick={() => setEdit({ ...edit, email: s })}>
                          {s}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Row 3: Phone + LinkedIn */}
              <div className="grid2">
                <div className="field">
                  <label>Phone</label>
                  <input value={editPhone} placeholder="+1 555 000 0000"
                    onChange={(e) => setEditPhone(e.target.value)} />
                </div>
                <div className="field">
                  <label>LinkedIn URL</label>
                  <input value={editLinkedin} placeholder="linkedin.com/in/janesmith"
                    onChange={(e) => setEditLinkedin(e.target.value)} />
                </div>
              </div>

              {/* Row 4: Category + Industry + Country + Deal size */}
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr 1fr 1fr', gap:'0 12px' }}>
                <div className="field">
                  <label>Category</label>
                  <input value={edit.category||''} placeholder="SaaS"
                    onChange={(e) => setEdit({ ...edit, category: e.target.value })} />
                </div>
                <div className="field">
                  <label>Industry</label>
                  <input value={edit.industry||''} placeholder="Tech"
                    onChange={(e) => setEdit({ ...edit, industry: e.target.value })} />
                </div>
                <div className="field">
                  <label>Country</label>
                  <input value={edit.country||''} placeholder="USA"
                    onChange={(e) => setEdit({ ...edit, country: e.target.value })} />
                </div>
                <div className="field">
                  <label>Deal size</label>
                  <input value={edit.opportunity_size||''} placeholder="$10K–$50K"
                    onChange={(e) => setEdit({ ...edit, opportunity_size: e.target.value })} />
                </div>
              </div>

              {/* Row 5: Score + Status */}
              <div className="grid2">
                <div className="field">
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:4 }}>
                    <label style={{ margin:0 }}>Lead score</label>
                    <span style={{ fontSize:12, fontWeight:700, color: scoreColor }}>{edit.lead_score} — {scoreLabel}</span>
                  </div>
                  <input type="range" min="0" max="100" value={edit.lead_score}
                    onChange={(e) => setEdit({ ...edit, lead_score: Number(e.target.value) })}
                    style={{ width:'100%', accentColor: scoreColor }} />
                </div>
                <div className="field">
                  <label>Status</label>
                  <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Notes */}
              <div className="field" style={{ marginBottom:0 }}>
                <label>Notes</label>
                <textarea rows="2" value={stripMetaFromNotes(edit.notes)}
                  placeholder="Any context, next steps, or research notes…"
                  onChange={(e) => setEdit({ ...edit, notes: e.target.value })} />
              </div>
            </form>
          </Modal>
        );
      })()}

      {/* Email compose modal with Edit / Preview tabs */}
      {compose && (
        <Modal title={`✍️ Email — ${compose.company}`} onClose={() => setCompose(null)}>
          <form onSubmit={doSend}>
            <div style={{ display:'flex', gap:10, marginBottom:14, alignItems:'flex-end' }}>
              <div className="field" style={{ flex:1, marginBottom:0 }}>
                <label>To</label><input value={compose.email} readOnly style={{ background:'var(--bg)' }} />
              </div>
              <div className="field" style={{ flex:1, marginBottom:0 }}>
                <label>Pitch angle</label>
                <select value={angle} onChange={(e) => regen(e.target.value)}>
                  {ANGLES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => regen()} style={{ marginBottom:1, whiteSpace:'nowrap' }}>🔄 Regen</button>
            </div>
            <div className="field"><label>Subject</label><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required /></div>
            <div className="field">
              <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:6 }}>
                <label style={{ margin:0 }}>Message</label>
                <div style={{ display:'flex', gap:4 }}>
                  <button type="button" className={`btn btn-sm ${emailTab==='edit' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding:'4px 10px', fontSize:12 }} onClick={() => setEmailTab('edit')}>✏️ Edit</button>
                  <button type="button" className={`btn btn-sm ${emailTab==='preview' ? 'btn-primary' : 'btn-ghost'}`} style={{ padding:'4px 10px', fontSize:12 }} onClick={() => setEmailTab('preview')}>👁 Preview</button>
                </div>
              </div>
              {emailTab === 'edit' ? (
                <textarea rows="11" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required
                  style={{ fontFamily:'monospace', fontSize:12, lineHeight:1.5 }} />
              ) : (
                <iframe
                  srcDoc={`<!DOCTYPE html><html><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;padding:20px;font-size:14px;line-height:1.6;color:#0f172a;max-width:560px">${draft.body}</body></html>`}
                  style={{ width:'100%', height:260, border:'1.5px solid var(--border)', borderRadius:9 }}
                  sandbox="allow-same-origin"
                  title="Email preview"
                />
              )}
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0 4px', borderTop:'1px solid var(--border)' }}>
              <span style={{ fontSize:12, color:'var(--muted)', flex:1 }}>Sends via moizahmad1604@gmail.com</span>
              <button type="button" className="btn btn-ghost" onClick={() => setCompose(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={sending} style={{ minWidth:130 }}>{sending ? '📨 Sending…' : '📨 Send Email'}</button>
            </div>
          </form>
        </Modal>
      )}

      {/* Send All modal */}
      {sendAllOpen && (
        <div className="overlay" onClick={(e) => { if (e.target.classList.contains('overlay') && !sendAllProg.running) setSendAllOpen(false); }}>
          <div className="modal" style={{ maxWidth:460 }}>
            <div className="modal-head">
              <h3>📨 Send emails to all leads</h3>
              {!sendAllProg.running && <button className="x-btn" onClick={() => setSendAllOpen(false)}>×</button>}
            </div>
            <div className="modal-body">
              {!sendAllProg.running && !sendAllProg.done ? (<>
                {/* Mode picker */}
                <div style={{ display:'flex', gap:10, marginBottom:20 }}>
                  <button
                    className={`btn ${sendAllMode==='unsent' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex:1, flexDirection:'column', height:'auto', padding:'14px', gap:4 }}
                    onClick={() => setSendAllMode('unsent')}>
                    <div style={{ fontSize:22 }}>📬</div>
                    <div style={{ fontWeight:800, fontSize:13 }}>Unsent only</div>
                    <div style={{ fontSize:11, opacity:.8 }}>
                      {leads.filter((l) => l.email && !l.email_sent).length} leads not yet emailed
                    </div>
                  </button>
                  <button
                    className={`btn ${sendAllMode==='all' ? 'btn-primary' : 'btn-ghost'}`}
                    style={{ flex:1, flexDirection:'column', height:'auto', padding:'14px', gap:4 }}
                    onClick={() => setSendAllMode('all')}>
                    <div style={{ fontSize:22 }}>📤</div>
                    <div style={{ fontWeight:800, fontSize:13 }}>All with email</div>
                    <div style={{ fontSize:11, opacity:.8 }}>
                      {leads.filter((l) => l.email).length} total leads with email
                    </div>
                  </button>
                </div>

                <div className="alert alert-ok" style={{ marginBottom:16 }}>
                  <b>{sendAllPool.length} email{sendAllPool.length !== 1 ? 's' : ''}</b> will be auto-drafted and sent using your saved templates. Each lead gets a personalised message.
                </div>

                {sendAllPool.length === 0 ? (
                  <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:'8px 0' }}>
                    No leads match this filter.
                  </div>
                ) : (
                  <div style={{ fontSize:12, color:'var(--muted)', marginBottom:4 }}>
                    Sends from: <b>moizahmad1604@gmail.com</b> · Auto-drafts personalised pitch per lead
                  </div>
                )}
              </>) : sendAllProg.running ? (<>
                {/* Live progress */}
                <div style={{ textAlign:'center', marginBottom:16 }}>
                  <div style={{ fontSize:32, marginBottom:8 }}>📨</div>
                  <div style={{ fontWeight:700, fontSize:15, marginBottom:4 }}>Sending emails…</div>
                  <div style={{ fontSize:13, color:'var(--muted)' }}>
                    {sendAllProg.done} of {sendAllProg.total} sent
                    {sendAllProg.current && ` · ${sendAllProg.current}`}
                  </div>
                </div>
                <div style={{ height:8, background:'var(--border)', borderRadius:99, overflow:'hidden', marginBottom:8 }}>
                  <div style={{
                    height:'100%', borderRadius:99,
                    width:`${Math.round((sendAllProg.done/sendAllProg.total)*100)}%`,
                    background:'linear-gradient(90deg,#6366f1,#22c55e)',
                    transition:'width .3s ease',
                  }} />
                </div>
                <div style={{ fontSize:12, color:'var(--muted)', textAlign:'center' }}>
                  {Math.round((sendAllProg.done/sendAllProg.total)*100)}% complete
                  {sendAllProg.errors > 0 && <span style={{ color:'var(--red)', marginLeft:8 }}>{sendAllProg.errors} errors</span>}
                </div>
              </>) : (<>
                {/* Done state */}
                <div style={{ textAlign:'center', padding:'10px 0' }}>
                  <div style={{ fontSize:44, marginBottom:10 }}>🎉</div>
                  <div style={{ fontWeight:800, fontSize:18, marginBottom:6 }}>All done!</div>
                  <div style={{ fontSize:14, color:'var(--muted)', marginBottom:4 }}>
                    <b style={{ color:'var(--green)' }}>{sendAllProg.done - sendAllProg.errors}</b> emails sent successfully
                  </div>
                  {sendAllProg.errors > 0 && (
                    <div style={{ fontSize:13, color:'var(--red)' }}>{sendAllProg.errors} failed</div>
                  )}
                </div>
              </>)}
            </div>

            {!sendAllProg.running && (
              <div className="modal-foot">
                {!sendAllProg.done ? (<>
                  <button className="btn btn-ghost" onClick={() => setSendAllOpen(false)}>Cancel</button>
                  <button className="btn btn-primary" disabled={sendAllPool.length === 0}
                    onClick={sendAll} style={{ minWidth:160 }}>
                    📨 Send {sendAllPool.length} email{sendAllPool.length !== 1 ? 's' : ''}
                  </button>
                </>) : (
                  <button className="btn btn-primary" onClick={() => { setSendAllOpen(false); setSendAllProg({ running:false, done:0, total:0, current:'', errors:0 }); }}>
                    ✓ Close
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* CSV Import modal */}
      {importData && (
        <Modal title="⬆️ Import Leads from CSV" onClose={() => setImportData(null)}
          footer={<>
            <span style={{ fontSize:12, color:'var(--muted)', flex:1 }}>{importData.rows.filter((r) => r[importData.mapping.company]).length} leads ready to import</span>
            <button className="btn btn-ghost" onClick={() => setImportData(null)}>Cancel</button>
            <button className="btn btn-primary" onClick={doImport} disabled={importing}>{importing ? 'Importing…' : `⬆️ Import ${importData.rows.filter((r) => r[importData.mapping.company]).length} leads`}</button>
          </>}>
          <div>
            <p style={{ fontSize:13, color:'var(--muted)', marginBottom:16 }}>
              Columns detected: <b>{importData.headers.join(', ')}</b>. We auto-mapped the fields below. Adjust if needed.
            </p>
            <div className="grid2">
              {LEAD_FIELDS.map((f) => (
                <div className="field" key={f}>
                  <label style={{ textTransform:'capitalize' }}>{f.replace('_', ' ')}</label>
                  <select value={importData.mapping[f] || ''} onChange={(e) => setImportData((d) => ({ ...d, mapping: { ...d.mapping, [f]: e.target.value } }))}>
                    <option value="">(skip)</option>
                    {importData.headers.map((h) => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              ))}
            </div>
            <div style={{ marginTop:12, background:'var(--bg)', borderRadius:9, padding:12, fontSize:12 }}>
              <b>Preview (first 3 rows):</b>
              {importData.rows.slice(0, 3).map((r, i) => (
                <div key={i} style={{ color:'var(--muted)', marginTop:4 }}>
                  {importData.mapping.company && <b style={{ color:'var(--text)' }}>{r[importData.mapping.company]}</b>}
                  {importData.mapping.email && ` · ${r[importData.mapping.email]}`}
                  {importData.mapping.country && ` · ${r[importData.mapping.country]}`}
                </div>
              ))}
            </div>
          </div>
        </Modal>
      )}
      {/* ── Confirm Lead modal ───────────────────────────────── */}
      {confirmLead && (() => {
        const l = confirmLead;
        const checks = [
          { label: 'Has email address',   ok: !!l.email },
          { label: 'Has contact name',    ok: !!l.contact },
          { label: 'Has website',         ok: !!l.website },
          { label: 'Lead score ≥ 70',     ok: (l.lead_score || 0) >= 70 },
          { label: 'Category identified', ok: !!l.category },
        ];
        const passCount = checks.filter((c) => c.ok).length;
        const pct       = Math.round((passCount / checks.length) * 100);
        const scoreColor = l.lead_score >= 80 ? '#22c55e' : l.lead_score >= 60 ? '#f59e0b' : '#94a3b8';
        const readyColor = passCount >= 4 ? '#22c55e' : passCount >= 3 ? '#f59e0b' : '#ef4444';
        const ready      = passCount >= 3;
        return (
          <div className="overlay" onClick={(e) => { if (e.target.classList.contains('overlay') && !confirming) setConfirmLead(null); }}>
            <div className="modal confirm-modal" style={{ maxWidth:500 }}>
              <div className="modal-head">
                <h3>Confirm Lead</h3>
                <button className="x-btn" onClick={() => setConfirmLead(null)}>×</button>
              </div>
              <div className="modal-body" style={{ padding:'20px 24px', display:'flex', flexDirection:'column', gap:18 }}>

                {/* Company header */}
                <div style={{ display:'flex', gap:14, alignItems:'center' }}>
                  <CoAvatar company={l.company} size={56} />
                  <div style={{ flex:1 }}>
                    <div style={{ fontWeight:800, fontSize:20, lineHeight:1.2 }}>{l.company}</div>
                    {l.contact && <div style={{ fontSize:13, color:'var(--muted)', marginTop:2 }}>{l.contact}</div>}
                    {l.category && <div style={{ fontSize:11, marginTop:4 }}><span className="tag">{l.category}</span></div>}
                  </div>
                  {/* Score ring */}
                  <div style={{ position:'relative', width:64, height:64, flexShrink:0 }}>
                    <svg width="64" height="64" style={{ transform:'rotate(-90deg)' }}>
                      <circle cx="32" cy="32" r="26" fill="none" stroke="var(--border)" strokeWidth="6"/>
                      <circle cx="32" cy="32" r="26" fill="none" stroke={scoreColor} strokeWidth="6"
                        strokeDasharray={`${2*Math.PI*26}`}
                        strokeDashoffset={`${2*Math.PI*26 * (1 - (l.lead_score||0)/100)}`}
                        strokeLinecap="round"/>
                    </svg>
                    <div style={{ position:'absolute', inset:0, display:'flex', flexDirection:'column', alignItems:'center', justifyContent:'center' }}>
                      <span style={{ fontSize:16, fontWeight:800, color:scoreColor, lineHeight:1 }}>{l.lead_score || 0}</span>
                      <span style={{ fontSize:9, color:'var(--muted)', fontWeight:600 }}>SCORE</span>
                    </div>
                  </div>
                </div>

                {/* Detail grid */}
                <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'6px 16px', background:'var(--bg)', borderRadius:10, padding:'12px 14px', fontSize:13 }}>
                  {[
                    { k:'Email',     v: l.email },
                    { k:'Website',   v: l.website },
                    { k:'Country',   v: l.country },
                    { k:'Size',      v: l.opportunity_size },
                  ].map(({ k, v }) => v ? (
                    <div key={k}>
                      <span style={{ color:'var(--muted)', fontSize:11, fontWeight:600 }}>{k} </span>
                      <span style={{ fontWeight:600, wordBreak:'break-all' }}>{v}</span>
                    </div>
                  ) : null)}
                </div>

                {/* Qualification checklist */}
                <div>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10 }}>
                    <span style={{ fontWeight:700, fontSize:13 }}>Qualification checklist</span>
                    <span style={{ fontSize:12, fontWeight:700, color:readyColor, background:readyColor+'18', padding:'2px 10px', borderRadius:20 }}>
                      {passCount}/{checks.length} checks passed
                    </span>
                  </div>
                  <div style={{ display:'flex', flexDirection:'column', gap:6 }}>
                    {checks.map((c) => (
                      <div key={c.label} style={{ display:'flex', alignItems:'center', gap:10, fontSize:13 }}>
                        <span style={{ width:20, height:20, borderRadius:'50%', background: c.ok ? '#dcfce7' : '#fee2e2', color: c.ok ? '#16a34a' : '#dc2626', display:'flex', alignItems:'center', justifyContent:'center', fontWeight:800, fontSize:12, flexShrink:0 }}>
                          {c.ok ? '✓' : '✕'}
                        </span>
                        <span style={{ color: c.ok ? 'var(--text)' : 'var(--muted)' }}>{c.label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Readiness banner */}
                <div style={{ borderRadius:9, padding:'10px 14px', background: ready ? '#f0fdf4' : '#fef9ec', border:`1px solid ${ready ? '#bbf7d0' : '#fde68a'}`, fontSize:13, color: ready ? '#15803d' : '#92400e', fontWeight:600 }}>
                  {ready
                    ? `✅ This lead looks qualified. Ready to move to the pipeline.`
                    : `⚠️ This lead may need more information before confirming.`}
                </div>
              </div>

              <div className="modal-foot" style={{ gap:8 }}>
                <button className="btn btn-ghost" disabled={confirming} onClick={() => setConfirmLead(null)}>Cancel</button>
                <button className="btn btn-sm" disabled={confirming}
                  style={{ background:'#fef2f2', color:'#dc2626', border:'1px solid #fecaca', fontWeight:700 }}
                  onClick={() => doConfirm('reject')}>
                  {confirming ? '…' : '❌ Not Qualified'}
                </button>
                <button className="btn btn-primary" disabled={confirming}
                  style={{ background:'#22c55e', minWidth:150, fontWeight:700 }}
                  onClick={() => doConfirm('qualify')}>
                  {confirming ? 'Saving…' : '✅ Confirm & Qualify'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </Page>
  );
}
