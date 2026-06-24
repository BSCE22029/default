import { useEffect, useMemo, useState } from 'react';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill, CoAvatar } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';

const STATUSES  = ['New Lead','Contacted','Qualified','Proposal Sent','Negotiation','Closed Won','Closed Lost'];
const PAGE_SIZE = 25;
const BLANK = { company:'', contact:'', email:'', website:'', industry:'', country:'', category:'', lead_score:50, opportunity_size:'', status:'New Lead', notes:'' };
const DEMO  = [
  { company:'Samsara',   contact:'Sanjit Biswas',    email:'sanjit@samsara.com', category:'IoT',  industry:'Fleet Tech',       country:'USA', lead_score:92, opportunity_size:'$50K–$200K' },
  { company:'Tempus AI', contact:'Eric Lefkofsky',   email:'eric@tempus.com',    category:'AI/ML',industry:'HealthTech',        country:'USA', lead_score:88, opportunity_size:'$80K–$300K' },
  { company:'Zendesk',   contact:'Tom Eggemeier',    email:'tom@zendesk.com',    category:'SaaS', industry:'Customer Support',  country:'USA', lead_score:79, opportunity_size:'$40K–$160K' },
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
  { id:'all',    label:'All' },
  { id:'email',  label:'✉️ Has Email' },
  { id:'phone',  label:'📞 Has Phone' },
  { id:'nosite', label:'🌐 No Website' },
  { id:'hot',    label:'🔥 Hot (≥70)' },
  { id:'unsent', label:'📬 Not Emailed' },
];

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
  const [sending,     setSending]     = useState(false);
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkProg,    setBulkProg]    = useState({ done:0, total:0, current:'' });
  const [detailLead,  setDetailLead]  = useState(null);
  const [detailNote,  setDetailNote]  = useState('');
  const [savingNote,  setSavingNote]  = useState(false);
  const [savingStatus,setSavingStatus]= useState(null);
  const [toast,       setToast]       = useState('');
  const [page,        setPage]        = useState(1);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('app_leads').select('*').order('created_at', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let rows = leads.filter((l) => {
      const s = (q || '').toLowerCase();
      const hit = !s || [l.company, l.contact, l.email, l.category, l.country].some((v) => (v||'').toLowerCase().includes(s));
      if (!hit) return false;
      if (fStatus && l.status !== fStatus) return false;
      if (fQuick === 'email')  return l.email && l.email !== '';
      if (fQuick === 'phone')  return !!extractPhone(l.notes);
      if (fQuick === 'nosite') return !l.website || l.website === '';
      if (fQuick === 'hot')    return (l.lead_score||0) >= 70;
      if (fQuick === 'unsent') return !l.email_sent;
      return true;
    });
    if (sortBy === 'score')   rows = [...rows].sort((a,b) => (b.lead_score||0) - (a.lead_score||0));
    if (sortBy === 'company') rows = [...rows].sort((a,b) => (a.company||'').localeCompare(b.company||''));
    if (sortBy === 'country') rows = [...rows].sort((a,b) => (a.country||'').localeCompare(b.country||''));
    if (sortBy === 'newest')  rows = [...rows].sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [leads, q, fStatus, fQuick, sortBy]);

  // Reset to page 1 when filters change
  useEffect(() => { setPage(1); }, [q, fStatus, fQuick, sortBy]);

  const pageCount = Math.ceil(filtered.length / PAGE_SIZE);
  const paginated = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const counts = useMemo(() => ({
    email:  leads.filter((l) => l.email && l.email !== '').length,
    phone:  leads.filter((l) => !!extractPhone(l.notes)).length,
    nosite: leads.filter((l) => !l.website || l.website === '').length,
    hot:    leads.filter((l) => (l.lead_score||0) >= 70).length,
    unsent: leads.filter((l) => !l.email_sent).length,
  }), [leads]);

  // ---------- helpers ----------
  function toast$(msg, ms = 3000) { setToast(msg); setTimeout(() => setToast(''), ms); }
  function toggleSelect(id) { setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; }); }
  function toggleAll()       { setSelected(selected.size === filtered.length ? new Set() : new Set(filtered.map((l) => l.id))); }

  function openDetail(l)  { setDetailLead(l); setDetailNote(l.notes || ''); }
  function openCompose(l) { const a = defaultAngle(l); setAngle(a); setCompose(l); setDraft(generateDraft(l, a)); }
  function regen(a)       { const x = a ?? angle; setAngle(x); setDraft(generateDraft(compose, x)); }

  async function changeStatus(l, status) {
    setSavingStatus(l.id);
    await supabase.from('app_leads').update({ status }).eq('id', l.id);
    setLeads((prev) => prev.map((x) => x.id === l.id ? { ...x, status } : x));
    if (detailLead?.id === l.id) setDetailLead((d) => ({ ...d, status }));
    setSavingStatus(null);
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

  async function save(e) {
    e.preventDefault();
    const payload = { ...edit, lead_score: Number(edit.lead_score) || 0 };
    if (edit.id) { const { id, ...rest } = payload; await supabase.from('app_leads').update(rest).eq('id', id); }
    else          await supabase.from('app_leads').insert({ ...payload, org_id: orgId });
    setEdit(null); load();
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

  return (
    <Page title="Leads" actions={
      <>
        <button className="btn btn-ghost btn-sm" onClick={exportCSV} title="Export current view as CSV">⬇️ Export</button>
        <button className="btn btn-ghost btn-sm" onClick={seedDemo}>+ Demo data</button>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...BLANK })}>+ Add Lead</button>
      </>
    }>
      {toast && <div className="alert alert-ok">{toast}</div>}

      {/* Search + filters */}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input placeholder="Search company, contact, email, country…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
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
          {pageCount > 1 && ` · page ${page}/${pageCount}`}
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
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          {loading ? <div className="empty">Loading…</div> : filtered.length === 0 ? (
            <div className="empty">No leads match filters.</div>
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
                  <th></th>
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
                          <div>
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
                      <td style={{ fontSize:12 }}>{l.country}</td>
                      <td>
                        <select
                          className="status-sel"
                          value={l.status}
                          onChange={(e) => changeStatus(l, e.target.value)}
                          disabled={savingStatus === l.id}
                          style={{ ...style }}
                        >
                          {STATUSES.map((s) => <option key={s}>{s}</option>)}
                        </select>
                        {l.email_sent && <span style={{ fontSize:10, marginLeft:4 }}>✉️</span>}
                      </td>
                      <td style={{ textAlign:'center' }}>
                        <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>{l.lead_score}</span>
                      </td>
                      <td style={{ whiteSpace:'nowrap' }}>
                        <button className="btn btn-sm" style={{ background: l.email ? '#f0fdf4' : '#f8fafc', color: l.email ? '#166534' : '#94a3b8', minWidth:72 }}
                          disabled={!l.email} onClick={() => openCompose(l)}>✍️ Email</button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(l)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        {/* Pagination */}
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
          <span style={{ fontSize:13, whiteSpace:'nowrap' }}>{selected.size} selected</span>
          <button className="btn btn-primary btn-sm" onClick={sendBulk} disabled={bulkSending} style={{ minWidth:140 }}>
            {bulkSending ? `📨 ${bulkProg.done}/${bulkProg.total} — ${bulkProg.current}` : `📨 Email all ${selected.size}`}
          </button>
          <button className="btn btn-ghost btn-sm" onClick={exportCSV}>⬇️ CSV</button>
          <button className="btn btn-ghost btn-sm" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}

      {/* Lead detail drawer */}
      {detailLead && (<>
        <div className="drawer-overlay" onClick={() => setDetailLead(null)} />
        <aside className="drawer">
          <div className="drawer-head">
            <div>
              <div style={{ fontWeight:800, fontSize:18 }}>{detailLead.company}</div>
              <div style={{ display:'flex', gap:8, marginTop:6, flexWrap:'wrap' }}>
                <span className={`score-badge ${detailLead.lead_score >= 80 ? 'hot' : detailLead.lead_score >= 60 ? 'warm' : 'cold'}`}>{detailLead.lead_score} pts</span>
                {!detailLead.website && <span style={{ fontSize:11, fontWeight:700, color:'#f59e0b', padding:'3px 8px', background:'#fef3c7', borderRadius:20 }}>No website</span>}
                {detailLead.opportunity_size && <span style={{ fontSize:11, color:'var(--muted)' }}>{detailLead.opportunity_size}</span>}
              </div>
            </div>
            <button className="btn btn-ghost btn-sm" onClick={() => setDetailLead(null)}>✕ Close</button>
          </div>

          <div className="drawer-body">
            {/* Quick actions */}
            <div className="drawer-actions">
              <button className="btn btn-primary btn-sm" disabled={!detailLead.email}
                onClick={() => { setDetailLead(null); openCompose(detailLead); }}>✍️ Email</button>
              <button className="btn btn-ghost btn-sm"
                onClick={() => { setDetailLead(null); setEdit(detailLead); }}>✏️ Edit</button>
              <button className="btn btn-danger btn-sm"
                onClick={() => { setDetailLead(null); remove(detailLead); }}>🗑 Delete</button>
            </div>

            {/* Contact */}
            <div className="drawer-section">
              <div className="drawer-label">Contact</div>
              <div style={{ fontWeight:600, fontSize:14 }}>{detailLead.contact || '—'}</div>
              {detailLead.email && <div style={{ marginTop:4 }}><a href={`mailto:${detailLead.email}`} style={{ color:'var(--primary)', fontSize:13 }}>{detailLead.email}</a></div>}
              {extractPhone(detailLead.notes) && <div style={{ marginTop:2 }}><a href={`tel:${extractPhone(detailLead.notes)}`} style={{ fontSize:13 }}>📞 {extractPhone(detailLead.notes)}</a></div>}
            </div>

            {/* Company info */}
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

            {/* Status + email history */}
            <div className="drawer-section">
              <div className="drawer-label">Status</div>
              <select
                className="status-sel"
                value={detailLead.status}
                onChange={(e) => changeStatus(detailLead, e.target.value)}
                style={{ ...(STATUS_STYLE[detailLead.status] || {}), padding:'5px 14px', fontSize:13 }}
              >
                {STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
              {detailLead.email_sent && (
                <div style={{ marginTop:8, fontSize:12, color:'var(--muted)' }}>
                  ✉️ Email sent {detailLead.last_contact ? new Date(detailLead.last_contact).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : ''}
                </div>
              )}
            </div>

            {/* Notes */}
            <div className="drawer-section">
              <div className="drawer-label">Notes</div>
              <textarea rows={5} value={detailNote} onChange={(e) => setDetailNote(e.target.value)}
                style={{ width:'100%', border:'1.5px solid var(--border)', borderRadius:9, padding:'8px 10px', resize:'vertical', fontSize:13, lineHeight:1.5 }} />
              <button className="btn btn-sm btn-primary" style={{ marginTop:8 }} onClick={saveNote} disabled={savingNote}>
                {savingNote ? 'Saving…' : '💾 Save notes'}
              </button>
            </div>

            {/* Created */}
            <div style={{ fontSize:11, color:'var(--muted)', paddingTop:4 }}>
              Added {detailLead.created_at ? new Date(detailLead.created_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' }) : '—'}
              {detailLead.country && ` · ${detailLead.country}`}
            </div>
          </div>
        </aside>
      </>)}

      {/* Add / Edit modal */}
      {edit && (
        <Modal title={edit.id ? `Edit — ${edit.company}` : 'Add Lead'} onClose={() => setEdit(null)}
          footer={<><button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button><button className="btn btn-primary" form="leadForm">Save</button></>}>
          <form id="leadForm" onSubmit={save}>
            <div className="grid2">
              <div className="field"><label>Company *</label><input required value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></div>
              <div className="field"><label>Website</label><input value={edit.website||''} onChange={(e) => setEdit({ ...edit, website: e.target.value })} /></div>
              <div className="field"><label>Contact</label><input value={edit.contact||''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></div>
              <div className="field"><label>Email</label><input type="email" value={edit.email||''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
              <div className="field"><label>Category</label><input value={edit.category||''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
              <div className="field"><label>Industry</label><input value={edit.industry||''} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} /></div>
              <div className="field"><label>Country</label><input value={edit.country||''} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
              <div className="field"><label>Deal size</label><input value={edit.opportunity_size||''} onChange={(e) => setEdit({ ...edit, opportunity_size: e.target.value })} /></div>
              <div className="field"><label>Score</label><input type="number" min="0" max="100" value={edit.lead_score} onChange={(e) => setEdit({ ...edit, lead_score: e.target.value })} /></div>
              <div className="field"><label>Status</label>
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            <div className="field"><label>Notes</label><textarea rows="3" value={edit.notes||''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
          </form>
        </Modal>
      )}

      {/* Auto-draft email modal */}
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => regen()} style={{ marginBottom:1, whiteSpace:'nowrap' }}>🔄 New draft</button>
            </div>
            <div className="field"><label>Subject</label><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required /></div>
            <div className="field">
              <label>Message <span style={{ fontWeight:400, color:'var(--muted)', fontSize:12 }}>(HTML)</span></label>
              <textarea rows="12" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required style={{ fontFamily:'monospace', fontSize:12, lineHeight:1.5 }} />
            </div>
            <div style={{ display:'flex', alignItems:'center', gap:10, padding:'10px 0 4px', borderTop:'1px solid var(--border)' }}>
              <span style={{ fontSize:12, color:'var(--muted)', flex:1 }}>Sends via moizahmad1604@gmail.com</span>
              <button type="button" className="btn btn-ghost" onClick={() => setCompose(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={sending} style={{ minWidth:130 }}>{sending ? '📨 Sending…' : '📨 Send Email'}</button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
