import { useEffect, useMemo, useState } from 'react';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';

const STATUSES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Closed Won', 'Closed Lost'];
const BLANK = { company: '', contact: '', email: '', website: '', industry: '', country: '', category: '', lead_score: 50, opportunity_size: '', status: 'New Lead', notes: '' };

const DEMO = [
  { company: 'Samsara', contact: 'Sanjit Biswas', email: 'sanjit@samsara.com', category: 'IoT', industry: 'Fleet Tech', country: 'USA', lead_score: 92, opportunity_size: '$50K–$200K' },
  { company: 'Tempus AI', contact: 'Eric Lefkofsky', email: 'eric@tempus.com', category: 'AI/ML', industry: 'HealthTech', country: 'USA', lead_score: 88, opportunity_size: '$80K–$300K' },
  { company: 'Zendesk', contact: 'Tom Eggemeier', email: 'tom@zendesk.com', category: 'SaaS', industry: 'Customer Support', country: 'USA', lead_score: 79, opportunity_size: '$40K–$160K' },
];

export default function Leads() {
  const { orgId } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [edit, setEdit] = useState(null);      // lead being edited/created
  const [compose, setCompose] = useState(null); // lead being emailed
  const [toast, setToast] = useState('');

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('app_leads').select('*').order('created_at', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => leads.filter((l) => {
    const s = (q || '').toLowerCase();
    const hit = !s || [l.company, l.contact, l.email, l.category].some((v) => (v || '').toLowerCase().includes(s));
    return hit && (!fStatus || l.status === fStatus);
  }), [leads, q, fStatus]);

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

  async function doSend(e) {
    e.preventDefault();
    const f = e.target;
    try {
      f.querySelector('button[type=submit]').disabled = true;
      await sendEmail({ to: compose.email, subject: f.subject.value, html: f.body.value });
      await supabase.from('app_leads').update({
        email_sent: true, last_contact: new Date().toISOString(),
        status: compose.status === 'New Lead' ? 'Contacted' : compose.status,
      }).eq('id', compose.id);
      setCompose(null); setToast(`✅ Email sent to ${compose.email}`);
      setTimeout(() => setToast(''), 2500); load();
    } catch (err) {
      alert('Send failed: ' + err.message);
      f.querySelector('button[type=submit]').disabled = false;
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
      <div className="toolbar">
        <input placeholder="Search company, contact, email…" value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 240 }} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option value="">All statuses</option>
          {STATUSES.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span style={{ color: 'var(--muted)', fontSize: 13 }}>{filtered.length} of {leads.length}</span>
      </div>

      <div className="card">
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          {loading ? <div className="empty">Loading…</div> :
            filtered.length === 0 ? <div className="empty">No leads. Click <b>+ Add Lead</b> or <b>+ Demo data</b>.</div> : (
            <table>
              <thead><tr><th>Company</th><th>Contact</th><th>Category</th><th>Status</th><th>Score</th><th>Deal</th><th></th></tr></thead>
              <tbody>
                {filtered.map((l) => (
                  <tr key={l.id}>
                    <td><b>{l.company}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.website}</div></td>
                    <td>{l.contact}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.email}</div></td>
                    <td>{l.category}</td>
                    <td>{statusPill(l.status)}{l.email_sent && <span title="emailed"> ✉️</span>}</td>
                    <td><b>{l.lead_score}</b></td>
                    <td style={{ fontSize: 12 }}>{l.opportunity_size}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm" style={{ background: '#f0fdf4', color: '#166534' }} disabled={!l.email} onClick={() => setCompose(l)}>📨</button>{' '}
                      <button className="btn btn-sm btn-ghost" onClick={() => setEdit(l)}>Edit</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => remove(l)}>✕</button>
                    </td>
                  </tr>
                ))}
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

      {/* Compose email modal */}
      {compose && (
        <Modal title={`Email — ${compose.company}`} onClose={() => setCompose(null)}>
          <form onSubmit={doSend}>
            <div className="field"><label>To</label><input value={compose.email} disabled /></div>
            <div className="field"><label>Subject</label>
              <input name="subject" defaultValue={`Partnership opportunity — ${compose.company}`} required />
            </div>
            <div className="field"><label>Message</label>
              <textarea name="body" rows="7" required defaultValue={
`<p>Hi ${(compose.contact || 'there').split(' ')[0]},</p>
<p>I came across ${compose.company} and was impressed by your work. We provide specialized IT services for companies in your space and would love to explore a partnership.</p>
<p>Would you be open to a quick 15-minute call this week?</p>
<p>Best regards,<br>${''}</p>`} />
            </div>
            <div className="alert alert-ok">Sends via Gmail (moizahmad1604@gmail.com). HTML allowed.</div>
            <div className="modal-foot" style={{ padding: 0, borderTop: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={() => setCompose(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">📨 Send Email</button>
            </div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
