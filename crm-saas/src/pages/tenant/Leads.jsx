import { useEffect, useMemo, useState } from 'react';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';

const STATUSES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Closed Won', 'Closed Lost'];
const BLANK = { company: '', contact: '', email: '', website: '', industry: '', country: '', category: '', lead_score: 50, opportunity_size: '', status: 'New Lead', notes: '' };

const DEMO = [
  { company: 'Samsara', contact: 'Sanjit Biswas', email: 'sanjit@samsara.com', category: 'IoT', industry: 'Fleet Tech', country: 'USA', lead_score: 92, opportunity_size: '$50K–$200K' },
  { company: 'Tempus AI', contact: 'Eric Lefkofsky', email: 'eric@tempus.com', category: 'AI/ML', industry: 'HealthTech', country: 'USA', lead_score: 88, opportunity_size: '$80K–$300K' },
  { company: 'Zendesk', contact: 'Tom Eggemeier', email: 'tom@zendesk.com', category: 'SaaS', industry: 'Customer Support', country: 'USA', lead_score: 79, opportunity_size: '$40K–$160K' },
];

const QUICK_FILTERS = [
  { id: 'all',     label: 'All' },
  { id: 'email',   label: '✉️ Has Email' },
  { id: 'phone',   label: '📞 Has Phone' },
  { id: 'nosite',  label: '🌐 No Website' },
  { id: 'hot',     label: '🔥 Hot (≥70)' },
  { id: 'unsent',  label: '📬 Not Emailed' },
];

export default function Leads() {
  const { orgId } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [fQuick, setFQuick] = useState('all');
  const [sortBy, setSortBy] = useState('score');
  const [edit, setEdit] = useState(null);
  const [compose, setCompose] = useState(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [angle, setAngle] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('app_leads').select('*').order('created_at', { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => {
    let rows = leads.filter((l) => {
      const s = (q || '').toLowerCase();
      const hit = !s || [l.company, l.contact, l.email, l.category, l.country].some((v) => (v || '').toLowerCase().includes(s));
      if (!hit) return false;
      if (fStatus && l.status !== fStatus) return false;
      if (fQuick === 'email')  return l.email && l.email !== '';
      if (fQuick === 'phone')  return !!extractPhone(l.notes);
      if (fQuick === 'nosite') return !l.website || l.website === '';
      if (fQuick === 'hot')    return (l.lead_score || 0) >= 70;
      if (fQuick === 'unsent') return !l.email_sent;
      return true;
    });
    if (sortBy === 'score')   rows = [...rows].sort((a, b) => (b.lead_score || 0) - (a.lead_score || 0));
    if (sortBy === 'company') rows = [...rows].sort((a, b) => (a.company || '').localeCompare(b.company || ''));
    if (sortBy === 'country') rows = [...rows].sort((a, b) => (a.country || '').localeCompare(b.country || ''));
    if (sortBy === 'newest')  rows = [...rows].sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
    return rows;
  }, [leads, q, fStatus, fQuick, sortBy]);

  // counts for filter chips
  const counts = useMemo(() => ({
    email:  leads.filter((l) => l.email && l.email !== '').length,
    phone:  leads.filter((l) => !!extractPhone(l.notes)).length,
    nosite: leads.filter((l) => !l.website || l.website === '').length,
    hot:    leads.filter((l) => (l.lead_score || 0) >= 70).length,
    unsent: leads.filter((l) => !l.email_sent).length,
  }), [leads]);

  async function save(e) {
    e.preventDefault();
    const payload = { ...edit, lead_score: Number(edit.lead_score) || 0 };
    if (edit.id) {
      const { id, ...rest } = payload;
      await supabase.from('app_leads').update(rest).eq('id', id);
    } else {
      await supabase.from('app_leads').insert({ ...payload, org_id: orgId });
    }
    setEdit(null); load();
  }

  async function remove(l) {
    if (!confirm(`Delete lead "${l.company}"?`)) return;
    await supabase.from('app_leads').delete().eq('id', l.id);
    load();
  }

  async function seedDemo() {
    await supabase.from('app_leads').insert(DEMO.map((d) => ({ ...d, org_id: orgId, status: 'New Lead' })));
    load();
  }

  function openCompose(l) {
    const a = defaultAngle(l);
    setAngle(a);
    setCompose(l);
    setDraft(generateDraft(l, a));
  }

  function regen(newAngle) {
    const a = newAngle ?? angle;
    setAngle(a);
    setDraft(generateDraft(compose, a));
  }

  async function doSend(e) {
    e.preventDefault();
    setSending(true);
    try {
      await sendEmail({ to: compose.email, subject: draft.subject, html: draft.body });
      await supabase.from('app_leads').update({
        email_sent: true, last_contact: new Date().toISOString(),
        status: compose.status === 'New Lead' ? 'Contacted' : compose.status,
      }).eq('id', compose.id);
      setCompose(null);
      setToast(`✅ Email sent to ${compose.email}`);
      setTimeout(() => setToast(''), 3000);
      load();
    } catch (err) {
      alert('Send failed: ' + err.message);
    } finally {
      setSending(false);
    }
  }

  return (
    <Page title="Leads" actions={
      <>
        <button className="btn btn-ghost btn-sm" onClick={seedDemo}>+ Demo data</button>
        <button className="btn btn-primary btn-sm" onClick={() => setEdit({ ...BLANK })}>+ Add Lead</button>
      </>
    }>
      {toast && <div className="alert alert-ok">{toast}</div>}

      {/* Search + status filter row */}
      <div className="toolbar" style={{ marginBottom: 10 }}>
        <input placeholder="Search company, contact, email, country…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
          <option value="score">Sort: Score ↓</option>
          <option value="newest">Sort: Newest</option>
          <option value="company">Sort: Company A–Z</option>
          <option value="country">Sort: Country A–Z</option>
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13, marginLeft: 'auto' }}>{filtered.length} of {leads.length}</span>
      </div>

      {/* Quick filter chips */}
      <div className="filter-chips">
        {QUICK_FILTERS.map((f) => (
          <button key={f.id} className={`chip ${fQuick === f.id ? 'active' : ''}`} onClick={() => setFQuick(f.id)}>
            {f.label}
            {f.id !== 'all' && <span className="chip-count">{counts[f.id]}</span>}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          {loading ? <div className="empty">Loading…</div> :
            filtered.length === 0 ? (
              <div className="empty">No leads match your filters. <button className="muted-link" onClick={() => { setFQuick('all'); setQ(''); setFStatus(''); }}>Clear filters</button></div>
            ) : (
            <table>
              <thead>
                <tr>
                  <th>Company</th>
                  <th>Contact</th>
                  <th>Email</th>
                  <th>Phone</th>
                  <th>Category</th>
                  <th>Country</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center' }}>Score</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((l) => {
                  const phone = extractPhone(l.notes);
                  return (
                    <tr key={l.id}>
                      <td>
                        <b>{l.company}</b>
                        {(!l.website || l.website === '') ? (
                          <div style={{ fontSize: 11, color: '#f59e0b', fontWeight: 600 }}>No website</div>
                        ) : (
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            <a href={l.website.startsWith('http') ? l.website : 'https://' + l.website} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)' }}>{l.website.replace(/^https?:\/\//, '')}</a>
                          </div>
                        )}
                      </td>
                      <td style={{ fontSize: 13 }}>{l.contact || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                      <td style={{ fontSize: 12 }}>
                        {l.email ? (
                          <a href={`mailto:${l.email}`} style={{ color: 'var(--primary)' }}>{l.email}</a>
                        ) : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>
                        {phone ? <a href={`tel:${phone}`} style={{ color: 'var(--text)' }}>{phone}</a> : <span style={{ color: 'var(--muted)' }}>—</span>}
                      </td>
                      <td style={{ fontSize: 12 }}>{l.category}</td>
                      <td style={{ fontSize: 12 }}>{l.country}</td>
                      <td>
                        {statusPill(l.status)}
                        {l.email_sent && <span title="email sent" style={{ marginLeft: 4 }}>✉️</span>}
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>
                          {l.lead_score}
                        </span>
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        <button
                          className="btn btn-sm"
                          style={{ background: l.email ? '#f0fdf4' : '#f8fafc', color: l.email ? '#166534' : '#94a3b8', minWidth: 80 }}
                          disabled={!l.email}
                          title={l.email ? 'Auto-draft & send email' : 'No email — add one to enable'}
                          onClick={() => openCompose(l)}>
                          ✍️ Email
                        </button>{' '}
                        <button className="btn btn-sm btn-ghost" onClick={() => setEdit(l)}>Edit</button>{' '}
                        <button className="btn btn-sm btn-danger" onClick={() => remove(l)}>✕</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Add / edit modal */}
      {edit && (
        <Modal title={edit.id ? `Edit — ${edit.company}` : 'Add Lead'} onClose={() => setEdit(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setEdit(null)}>Cancel</button>
            <button className="btn btn-primary" form="leadForm">Save</button>
          </>}>
          <form id="leadForm" onSubmit={save}>
            <div className="grid2">
              <div className="field"><label>Company *</label><input required value={edit.company} onChange={(e) => setEdit({ ...edit, company: e.target.value })} /></div>
              <div className="field"><label>Website</label><input value={edit.website || ''} onChange={(e) => setEdit({ ...edit, website: e.target.value })} /></div>
              <div className="field"><label>Contact</label><input value={edit.contact || ''} onChange={(e) => setEdit({ ...edit, contact: e.target.value })} /></div>
              <div className="field"><label>Email</label><input type="email" value={edit.email || ''} onChange={(e) => setEdit({ ...edit, email: e.target.value })} /></div>
              <div className="field"><label>Category</label><input value={edit.category || ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })} /></div>
              <div className="field"><label>Industry</label><input value={edit.industry || ''} onChange={(e) => setEdit({ ...edit, industry: e.target.value })} /></div>
              <div className="field"><label>Country</label><input value={edit.country || ''} onChange={(e) => setEdit({ ...edit, country: e.target.value })} /></div>
              <div className="field"><label>Deal size</label><input value={edit.opportunity_size || ''} onChange={(e) => setEdit({ ...edit, opportunity_size: e.target.value })} /></div>
              <div className="field"><label>Lead score</label><input type="number" min="0" max="100" value={edit.lead_score} onChange={(e) => setEdit({ ...edit, lead_score: e.target.value })} /></div>
              <div className="field"><label>Status</label>
                <select value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>{STATUSES.map((s) => <option key={s}>{s}</option>)}</select>
              </div>
            </div>
            <div className="field"><label>Notes</label><textarea rows="3" value={edit.notes || ''} onChange={(e) => setEdit({ ...edit, notes: e.target.value })} /></div>
          </form>
        </Modal>
      )}

      {/* Auto-draft compose modal */}
      {compose && (
        <Modal title={`✍️ Email — ${compose.company}`} onClose={() => setCompose(null)}>
          <form onSubmit={doSend}>
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>To</label>
                <input value={compose.email} readOnly style={{ background: 'var(--bg)' }} />
              </div>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>Pitch angle</label>
                <select value={angle} onChange={(e) => regen(e.target.value)}>
                  {ANGLES.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => regen()} style={{ marginBottom: 1, whiteSpace: 'nowrap' }}>
                🔄 New draft
              </button>
            </div>
            <div className="field">
              <label>Subject</label>
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required />
            </div>
            <div className="field">
              <label>Message <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>(HTML — edit freely)</span></label>
              <textarea rows="12" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required
                style={{ fontFamily: 'monospace', fontSize: 12, lineHeight: 1.5 }} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 0 4px', borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 12, color: 'var(--muted)', flex: 1 }}>Sends via moizahmad1604@gmail.com</span>
              <button type="button" className="btn btn-ghost" onClick={() => setCompose(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={sending} style={{ minWidth: 130 }}>
                {sending ? '📨 Sending…' : '📨 Send Email'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
