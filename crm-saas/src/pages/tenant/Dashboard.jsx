import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';

const GOAL = 5;

export default function Dashboard() {
  const { profile } = useAuth();
  const nav = useNavigate();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(null);
  const [draft, setDraft] = useState({ subject: '', body: '' });
  const [angle, setAngle] = useState('');
  const [sending, setSending] = useState(false);
  const [toast, setToast] = useState('');

  async function load() {
    const { data } = await supabase.from('app_leads').select('*').order('lead_score', { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  const total   = leads.length;
  const sent    = leads.filter((l) => l.email_sent).length;
  const replied = leads.filter((l) => l.email_replied).length;
  const won     = leads.filter((l) => l.status === 'Closed Won').length;
  const active  = leads.filter((l) => !['Closed Won', 'Closed Lost'].includes(l.status)).length;
  const avg     = total ? Math.round(leads.reduce((s, l) => s + (l.lead_score || 0), 0) / total) : 0;

  const todayStr = new Date().toISOString().split('T')[0];
  const sentToday = leads.filter((l) => l.last_contact && l.last_contact.startsWith(todayStr)).length;
  const goalPct = Math.min(100, Math.round((sentToday / GOAL) * 100));
  const goalDone = sentToday >= GOAL;

  // Top 5 uncontacted leads that have an email — the "strike list"
  const strikeList = leads
    .filter((l) => l.email && !l.email_sent && l.status === 'New Lead')
    .slice(0, GOAL);

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
        status: 'Contacted',
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
    <Page title="Dashboard">
      {toast && <div className="alert alert-ok" style={{ marginBottom: 16 }}>{toast}</div>}
      {loading ? <div className="center">Loading…</div> : (
        <>
          {/* KPI stats */}
          <div className="stats">
            <div className="stat blue"><div className="label">Total Leads</div><div className="value">{total}</div><div className="sub">in your workspace</div></div>
            <div className="stat green"><div className="label">Emails Sent</div><div className="value">{sent}</div><div className="sub">{replied} replied</div></div>
            <div className="stat orange"><div className="label">Active Pipeline</div><div className="value">{active}</div><div className="sub">{won} won</div></div>
            <div className="stat purple"><div className="label">Avg Lead Score</div><div className="value">{avg}</div><div className="sub">out of 100</div></div>
          </div>

          {/* Daily goal */}
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <div>
                <h3>🎯 Today's Goal — {GOAL} Confirmations</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
                  Email at least {GOAL} leads today to maximise your chances of closing within 24 hrs
                </p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: goalDone ? 'var(--green)' : 'var(--primary)' }}>
                {sentToday}/{GOAL} {goalDone ? '🎉 Goal hit!' : 'sent today'}
              </span>
            </div>
            <div className="card-body">
              <div className="progress-track">
                <div className="progress-bar" style={{ width: goalPct + '%', background: goalDone ? 'var(--green)' : 'var(--primary)' }} />
              </div>

              {strikeList.length === 0 ? (
                <div className="empty" style={{ margin: '14px 0 4px' }}>
                  {goalDone ? '🎉 All done for today! Check back tomorrow.' : 'No uncontacted leads with emails — generate more in Lead Generator.'}
                </div>
              ) : (
                <>
                  <p style={{ fontSize: 12, color: 'var(--muted)', margin: '14px 0 10px', fontWeight: 600 }}>
                    TOP PICKS — highest-scoring leads to contact right now
                  </p>
                  <div className="strike-list">
                    {strikeList.map((l) => (
                      <div key={l.id} className="strike-row">
                        <div className="strike-score" style={{ background: l.lead_score >= 80 ? '#fef3c7' : '#f0f9ff', color: l.lead_score >= 80 ? '#92400e' : '#0369a1' }}>
                          {l.lead_score}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 13 }}>{l.company}</div>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                            {l.email}
                            {!l.website && <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>· No website</span>}
                            {extractPhone(l.notes) && <span style={{ marginLeft: 6, color: 'var(--muted)' }}>· 📞 {extractPhone(l.notes)}</span>}
                          </div>
                        </div>
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                          <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>{l.country}</span>
                          <button className="btn btn-sm btn-primary" onClick={() => openCompose(l)}>✍️ Email</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  {strikeList.length === GOAL && (
                    <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 10 }}>
                      Email all {GOAL} → status updates to "Contacted" automatically. <Link to="/app/leads" style={{ color: 'var(--primary)' }}>View all leads →</Link>
                    </p>
                  )}
                </>
              )}
            </div>
          </div>

          {/* Recent leads */}
          <div className="card">
            <div className="card-head"><h3>Recent leads</h3><Link className="btn btn-sm" to="/app/leads">View all →</Link></div>
            <div className="card-body" style={{ padding: 0 }}>
              {total === 0 ? (
                <div className="empty">No leads yet. <Link className="muted-link" to="/app/leads">Add your first lead</Link> to get started.</div>
              ) : (
                <table>
                  <thead><tr><th>Company</th><th>Contact / Email</th><th>Status</th><th>Score</th><th>Country</th></tr></thead>
                  <tbody>
                    {leads.slice(0, 8).map((l) => (
                      <tr key={l.id}>
                        <td>
                          <b>{l.company}</b>
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.category}</div>
                        </td>
                        <td>
                          {l.contact || '—'}
                          <div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.email || extractPhone(l.notes) || '—'}</div>
                        </td>
                        <td>{statusPill(l.status)}{l.email_sent && <span title="emailed" style={{ marginLeft: 4 }}>✉️</span>}</td>
                        <td>
                          <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>
                            {l.lead_score}
                          </span>
                        </td>
                        <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.country}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}

      {/* Compose modal (same as Leads page) */}
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => regen()} style={{ marginBottom: 1 }}>
                🔄 New draft
              </button>
            </div>
            <div className="field">
              <label>Subject</label>
              <input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required />
            </div>
            <div className="field">
              <label>Message <span style={{ fontWeight: 400, color: 'var(--muted)', fontSize: 12 }}>(HTML — edit freely)</span></label>
              <textarea rows="10" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required
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
