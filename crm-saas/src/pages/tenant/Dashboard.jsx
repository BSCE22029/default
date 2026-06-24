import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';

const GOAL = 5;

export default function Dashboard() {
  const { profile } = useAuth();
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

  const todayStr   = new Date().toISOString().split('T')[0];
  const sentToday  = leads.filter((l) => l.last_contact?.startsWith(todayStr)).length;
  const goalPct    = Math.min(100, Math.round((sentToday / GOAL) * 100));
  const goalDone   = sentToday >= GOAL;

  // Strike list: top uncontacted leads with email
  const strikeList = leads.filter((l) => l.email && !l.email_sent && l.status === 'New Lead').slice(0, GOAL);

  // Follow-up radar: emailed ≥2 days ago, still "Contacted"
  const needFollowup = useMemo(() => leads.filter((l) => {
    if (!l.email_sent || !l.last_contact) return false;
    if (!['Contacted', 'Qualified'].includes(l.status)) return false;
    const days = (Date.now() - new Date(l.last_contact)) / 86400000;
    return days >= 2;
  }).slice(0, 8), [leads]);

  // Weekly activity chart (Mon–Sun)
  const weekData = useMemo(() => {
    const today = new Date();
    const dow = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => {
      const d = new Date(monday); d.setDate(monday.getDate() + i);
      const ds = d.toISOString().split('T')[0];
      return {
        day,
        added:   leads.filter((l) => l.created_at?.startsWith(ds)).length,
        emailed: leads.filter((l) => l.last_contact?.startsWith(ds)).length,
        isToday: ds === todayStr,
      };
    });
  }, [leads, todayStr]);
  const chartMax = Math.max(1, ...weekData.flatMap((d) => [d.added, d.emailed]));

  function openCompose(l) {
    const a = defaultAngle(l);
    setAngle(a); setCompose(l); setDraft(generateDraft(l, a));
  }
  function regen(a) { const x = a ?? angle; setAngle(x); setDraft(generateDraft(compose, x)); }

  async function doSend(e) {
    e.preventDefault(); setSending(true);
    try {
      await sendEmail({ to: compose.email, subject: draft.subject, html: draft.body });
      await supabase.from('app_leads').update({ email_sent: true, last_contact: new Date().toISOString(), status: 'Contacted' }).eq('id', compose.id);
      setCompose(null); setToast(`✅ Email sent to ${compose.email}`);
      setTimeout(() => setToast(''), 3000); load();
    } catch (err) { alert('Send failed: ' + err.message); }
    finally { setSending(false); }
  }

  return (
    <Page title="Dashboard">
      {toast && <div className="alert alert-ok" style={{ marginBottom: 16 }}>{toast}</div>}
      {loading ? <div className="center">Loading…</div> : (<>

        {/* KPIs */}
        <div className="stats">
          <div className="stat blue"><div className="label">Total Leads</div><div className="value">{total}</div><div className="sub">in your workspace</div></div>
          <div className="stat green"><div className="label">Emails Sent</div><div className="value">{sent}</div><div className="sub">{replied} replied</div></div>
          <div className="stat orange"><div className="label">Active Pipeline</div><div className="value">{active}</div><div className="sub">{won} won</div></div>
          <div className="stat purple"><div className="label">Avg Lead Score</div><div className="value">{avg}</div><div className="sub">out of 100</div></div>
        </div>

        {/* Today's goal + weekly chart — side by side */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 18 }}>

          {/* Goal tracker */}
          <div className="card">
            <div className="card-head">
              <div>
                <h3>🎯 Today's Goal — {GOAL} Confirmations</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Email {GOAL} leads today to maximise 24-hr closes</p>
              </div>
              <span style={{ fontSize: 13, fontWeight: 700, color: goalDone ? 'var(--green)' : 'var(--primary)' }}>
                {sentToday}/{GOAL} {goalDone ? '🎉' : ''}
              </span>
            </div>
            <div className="card-body">
              <div className="progress-track" style={{ marginBottom: 14 }}>
                <div className="progress-bar" style={{ width: goalPct + '%', background: goalDone ? 'var(--green)' : 'var(--primary)' }} />
              </div>
              {strikeList.length === 0 ? (
                <div style={{ color: 'var(--muted)', fontSize: 13, textAlign: 'center', padding: '10px 0' }}>
                  {goalDone ? '🎉 Goal hit! Check back tomorrow.' : 'No uncontacted leads with emails yet.'}
                </div>
              ) : (
                <div className="strike-list">
                  {strikeList.map((l) => (
                    <div key={l.id} className="strike-row">
                      <div className="strike-score" style={{ background: l.lead_score >= 80 ? '#fef3c7' : '#f0f9ff', color: l.lead_score >= 80 ? '#92400e' : '#0369a1' }}>
                        {l.lead_score}
                      </div>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{l.company}</div>
                        <div style={{ fontSize: 11, color: 'var(--muted)' }}>
                          {l.country}{!l.website && <span style={{ marginLeft: 6, color: '#f59e0b', fontWeight: 600 }}>· No site</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-primary" style={{ flexShrink: 0 }} onClick={() => openCompose(l)}>✍️</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Weekly activity chart */}
          <div className="card">
            <div className="card-head"><h3>📅 This Week's Activity</h3></div>
            <div className="card-body">
              <div className="mini-chart">
                {weekData.map((d) => (
                  <div key={d.day} className="mini-chart-col">
                    <div className="mini-bars">
                      <div className="mini-bar added"  style={{ height: Math.round((d.added   / chartMax) * 60) + 'px' }} title={`${d.added} leads added`} />
                      <div className="mini-bar emailed" style={{ height: Math.round((d.emailed / chartMax) * 60) + 'px' }} title={`${d.emailed} emailed`} />
                    </div>
                    <div className={`mini-day ${d.isToday ? 'today' : ''}`}>{d.day}</div>
                  </div>
                ))}
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot" style={{ background: 'var(--primary)', opacity: .8 }} /> Leads added</span>
                <span><span className="legend-dot" style={{ background: 'var(--green)', opacity: .8 }} /> Emailed</span>
              </div>
            </div>
          </div>
        </div>

        {/* Follow-up radar */}
        {needFollowup.length > 0 && (
          <div className="card" style={{ marginBottom: 18 }}>
            <div className="card-head">
              <h3>⏰ Follow-up Radar — {needFollowup.length} leads waiting</h3>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>Emailed 2+ days ago, no status change yet</span>
            </div>
            <div className="card-body">
              {needFollowup.map((l) => {
                const days = Math.floor((Date.now() - new Date(l.last_contact)) / 86400000);
                return (
                  <div key={l.id} className="followup-row">
                    <div className="followup-days">{days}d</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>{l.company}</div>
                      <div style={{ fontSize: 11, color: '#92400e' }}>{l.email} · {l.country}</div>
                    </div>
                    <button className="btn btn-sm" style={{ background: '#fff7ed', color: '#c2410c', border: '1px solid #fed7aa' }} onClick={() => openCompose(l)}>
                      🔁 Follow up
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent leads */}
        <div className="card">
          <div className="card-head"><h3>Recent leads</h3><Link className="btn btn-sm" to="/app/leads">View all →</Link></div>
          <div className="card-body" style={{ padding: 0 }}>
            {total === 0 ? (
              <div className="empty">No leads yet. <Link className="muted-link" to="/app/leads">Add your first lead</Link> to get started.</div>
            ) : (
              <table>
                <thead><tr><th>Company</th><th>Contact / Email</th><th>Status</th><th style={{ textAlign:'center' }}>Score</th><th>Country</th></tr></thead>
                <tbody>
                  {leads.slice(0, 8).map((l) => (
                    <tr key={l.id}>
                      <td><b>{l.company}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.category}</div></td>
                      <td>{l.contact || '—'}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.email || extractPhone(l.notes) || '—'}</div></td>
                      <td>{statusPill(l.status)}{l.email_sent && <span title="emailed" style={{ marginLeft: 4 }}>✉️</span>}</td>
                      <td style={{ textAlign:'center' }}>
                        <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>{l.lead_score}</span>
                      </td>
                      <td style={{ fontSize: 12, color: 'var(--muted)' }}>{l.country}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </>)}

      {/* Compose modal */}
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
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => regen()} style={{ marginBottom:1 }}>🔄</button>
            </div>
            <div className="field"><label>Subject</label><input value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} required /></div>
            <div className="field">
              <label>Message <span style={{ fontWeight:400, color:'var(--muted)', fontSize:12 }}>(HTML)</span></label>
              <textarea rows="10" value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} required style={{ fontFamily:'monospace', fontSize:12, lineHeight:1.5 }} />
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
