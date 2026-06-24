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

const ANGLES = [
  { id: 'website', label: '🌐 No website pitch' },
  { id: 'app',     label: '📱 Custom app pitch' },
  { id: 'ai',      label: '🤖 AI automation pitch' },
  { id: 'tech',    label: '⚡ Tech upgrade pitch' },
];

function extractCity(notes) {
  return (notes || '').match(/Found in ([^.]+)\./)?.[1] || '';
}

function generateDraft(lead, angle) {
  const first = (lead.contact || '').split(' ')[0] || 'there';
  const co = lead.company || 'your company';
  const noSite = !lead.website || lead.website === '';
  const domain = noSite ? '' : lead.website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  const city = extractCity(lead.notes);
  const inCity = city ? ` in ${city}` : '';
  const industry = lead.industry || lead.category || 'business';
  const sig = `<p style="color:#555;font-size:14px">Best regards,<br><strong>Moiz Ahmad</strong><br>Atronm — Web &amp; AI Development<br><a href="https://atronm.com">atronm.com</a></p>`;

  const resolved = angle || (noSite ? 'website' : 'tech');

  if (resolved === 'website') {
    return {
      subject: `Quick question about ${co}'s online presence`,
      body: `<p>Hi ${first},</p>
<p>I was looking for ${industry.toLowerCase()} businesses${inCity} and came across ${co}. I noticed you don't currently have a website — which means potential customers searching online simply can't find you.</p>
<p>At <strong>Atronm</strong>, we build clean, fast websites for businesses like yours — delivered in 2–3 weeks, starting from <strong>$1,500</strong>.</p>
<p>What you'd get:</p>
<ul>
  <li>Professional site that ranks on Google</li>
  <li>Contact/booking form so leads come to you</li>
  <li>Mobile-friendly, fast-loading design</li>
</ul>
<p>Would you be open to a quick 10-minute call this week to see if it's a fit?</p>
${sig}`,
    };
  }

  if (resolved === 'app') {
    return {
      subject: `Custom app idea for ${co}`,
      body: `<p>Hi ${first},</p>
<p>I came across ${co}${inCity} and had an idea I wanted to share.</p>
<p>We build custom web apps at <strong>Atronm</strong> that help ${industry.toLowerCase()} businesses automate their operations, serve clients online, and grow without extra headcount. Projects typically run <strong>$2,000–$6,000</strong> and go live in 4–6 weeks.</p>
<p>Examples of what we've built for similar businesses:</p>
<ul>
  <li>Customer portals and booking systems</li>
  <li>Internal dashboards and reporting tools</li>
  <li>E-commerce and payment integrations</li>
</ul>
<p>Is there a repetitive process at ${co} you wish was automated? Happy to brainstorm — no commitment needed.</p>
${sig}`,
    };
  }

  if (resolved === 'ai') {
    return {
      subject: `AI can save ${co} hours every week — quick idea`,
      body: `<p>Hi ${first},</p>
<p>I was researching ${industry.toLowerCase()} companies${inCity} and wanted to reach out to ${co} specifically.</p>
<p>At <strong>Atronm</strong>, we add AI to businesses like yours — think automatic lead follow-ups, smart data extraction, chatbots for your website, or AI-assisted reporting. Most integrations cost <strong>$1,500–$4,000</strong> and pay for themselves within weeks.</p>
<p>A few things AI could handle for ${co}:</p>
<ul>
  <li>Auto-reply to common customer questions 24/7</li>
  <li>Summarise documents or emails automatically</li>
  <li>Flag priority leads or tasks without manual review</li>
</ul>
<p>Worth a 15-minute call to explore what's possible? I can show you a live demo.</p>
${sig}`,
    };
  }

  // default: tech upgrade
  return {
    subject: `Atronm × ${co} — a quick idea`,
    body: `<p>Hi ${first},</p>
<p>I visited <a href="${lead.website.startsWith('http') ? lead.website : 'https://' + lead.website}">${domain}</a> and noticed ${co} is already established${inCity}. I wanted to reach out because we've helped similar ${industry.toLowerCase()} businesses take their technology to the next level.</p>
<p>At <strong>Atronm</strong>, we specialise in web apps, AI integrations, and cloud infrastructure. Our typical engagement is <strong>$2,000–$8,000</strong> and delivers in 4–6 weeks.</p>
<p>What we could do for ${co}:</p>
<ul>
  <li>Speed up or modernise your current site/app</li>
  <li>Build internal tools that reduce manual work</li>
  <li>Add AI features your competitors don't have yet</li>
</ul>
<p>Happy to jump on a 15-minute call — no pitch, just exploring if there's a fit.</p>
${sig}`,
  };
}

export default function Leads() {
  const { orgId } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [fStatus, setFStatus] = useState('');
  const [edit, setEdit] = useState(null);
  const [compose, setCompose] = useState(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [angle, setAngle] = useState('');
  const [sending, setSending] = useState(false);
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

  function openCompose(l) {
    const noSite = !l.website || l.website === '';
    const defaultAngle = noSite ? 'website' : 'tech';
    setAngle(defaultAngle);
    setCompose(l);
    setDraft(generateDraft(l, defaultAngle));
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
                    <td><b>{l.company}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.website || <span style={{ color: 'var(--amber, #f59e0b)' }}>No website</span>}</div></td>
                    <td>{l.contact}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.email}</div></td>
                    <td>{l.category}</td>
                    <td>{statusPill(l.status)}{l.email_sent && <span title="emailed"> ✉️</span>}</td>
                    <td><b>{l.lead_score}</b></td>
                    <td style={{ fontSize: 12 }}>{l.opportunity_size}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button
                        className="btn btn-sm"
                        style={{ background: l.email ? '#f0fdf4' : '#f8fafc', color: l.email ? '#166534' : '#94a3b8', minWidth: 80 }}
                        disabled={!l.email}
                        title={l.email ? 'Auto-draft & send email' : 'No email address — add one to enable'}
                        onClick={() => openCompose(l)}>
                        ✍️ Email
                      </button>{' '}
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

      {/* Auto-draft compose modal */}
      {compose && (
        <Modal title={`✍️ Email — ${compose.company}`} onClose={() => setCompose(null)}>
          <form onSubmit={doSend}>
            {/* To + pitch angle row */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 14, alignItems: 'flex-end' }}>
              <div className="field" style={{ flex: 1, marginBottom: 0 }}>
                <label>To</label>
                <input value={compose.email} readOnly style={{ background: 'var(--surface-2, #f8fafc)' }} />
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
