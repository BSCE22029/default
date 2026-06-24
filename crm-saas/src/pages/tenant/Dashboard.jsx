import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase, sendEmail } from '../../lib/supabase';
import Page, { Modal, statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { ANGLES, generateDraft, defaultAngle, extractPhone } from '../../lib/emailDraft';

const GOAL = 5;

function useCountUp(target, active) {
  const [val, setVal] = useState(0);
  const raf = useRef();
  useEffect(() => {
    if (!active || !target) { setVal(target); return; }
    const start = Date.now();
    const dur   = 900;
    function tick() {
      const t    = Math.min((Date.now() - start) / dur, 1);
      const ease = 1 - Math.pow(1 - t, 3);
      setVal(Math.round(ease * target));
      if (t < 1) raf.current = requestAnimationFrame(tick);
    }
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
  }, [target, active]);
  return val;
}

function greeting(name) {
  const h  = new Date().getHours();
  const g  = h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
  const fn = (name || '').split(/[\s@.]/)[0];
  return `${g}${fn ? ', ' + fn : ''} 👋`;
}

export default function Dashboard() {
  const { profile } = useAuth();
  const [leads,   setLeads]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [compose, setCompose] = useState(null);
  const [draft,   setDraft]   = useState({ subject:'', body:'' });
  const [angle,   setAngle]   = useState('');
  const [sending, setSending] = useState(false);
  const [toast,   setToast]   = useState('');
  const [batchBusy, setBatchBusy] = useState(false);

  async function load() {
    const { data } = await supabase.from('app_leads').select('*').order('lead_score', { ascending: false });
    setLeads(data || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  // Realtime subscription — refresh on any change
  useEffect(() => {
    const ch = supabase.channel('dashboard-rt')
      .on('postgres_changes', { event:'*', schema:'public', table:'app_leads' }, load)
      .subscribe();
    return () => supabase.removeChannel(ch);
  }, []);

  const total   = leads.length;
  const sent    = leads.filter((l) => l.email_sent).length;
  const replied = leads.filter((l) => l.email_replied).length;
  const won     = leads.filter((l) => l.status === 'Closed Won').length;
  const lost    = leads.filter((l) => l.status === 'Closed Lost').length;
  const active  = leads.filter((l) => !['Closed Won','Closed Lost'].includes(l.status)).length;
  const avg     = total ? Math.round(leads.reduce((s, l) => s + (l.lead_score || 0), 0) / total) : 0;

  const todayStr  = new Date().toISOString().split('T')[0];
  const sentToday = leads.filter((l) => l.last_contact?.startsWith(todayStr)).length;
  const goalPct   = Math.min(100, Math.round((sentToday / GOAL) * 100));
  const goalDone  = sentToday >= GOAL;

  const strikeList   = leads.filter((l) => l.email && !l.email_sent && l.status === 'New Lead').slice(0, GOAL);
  const needFollowup = useMemo(() => leads.filter((l) => {
    if (!l.email_sent || !l.last_contact) return false;
    if (!['Contacted','Qualified'].includes(l.status)) return false;
    return (Date.now() - new Date(l.last_contact)) / 86400000 >= 2;
  }).slice(0, 8), [leads]);

  const weekData = useMemo(() => {
    const today = new Date();
    const dow   = today.getDay();
    const mon   = new Date(today); mon.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'].map((day, i) => {
      const d  = new Date(mon); d.setDate(mon.getDate() + i);
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

  // Smart insights
  const insights = useMemo(() => {
    if (!total) return [];
    const items = [];
    const replyRate = sent > 0 ? Math.round((replied / sent) * 100) : 0;
    if (sent >= 5) {
      items.push(replyRate >= 20
        ? { ico:'🌟', color:'#22c55e', text:`${replyRate}% reply rate — great outreach performance!` }
        : { ico:'📬', color:'#f59e0b', text:`${replyRate}% reply rate. Try a different pitch angle.` }
      );
    }
    const hotUntouched = leads.filter((l) => l.lead_score >= 80 && !l.email_sent).length;
    if (hotUntouched)
      items.push({ ico:'🔥', color:'#ef4444', text:`${hotUntouched} hot lead${hotUntouched > 1 ? 's' : ''} (score ≥80) not emailed yet.` });

    const inNego = leads.filter((l) => l.status === 'Negotiation').length;
    if (inNego)
      items.push({ ico:'💰', color:'#8b5cf6', text:`${inNego} deal${inNego > 1 ? 's' : ''} in Negotiation — follow up this week.` });

    if (won + lost >= 3) {
      const wr = Math.round((won / (won + lost)) * 100);
      items.push({ ico: wr >= 60 ? '🏆' : '📈', color: wr >= 60 ? '#22c55e' : '#0ea5e9',
        text:`Win rate: ${wr}% (${won} won / ${lost} lost)` });
    }
    const cats = {};
    leads.forEach((l) => { if (l.category) cats[l.category] = (cats[l.category] || 0) + 1; });
    const top = Object.entries(cats).sort((a, b) => b[1] - a[1])[0];
    if (top)
      items.push({ ico:'📊', color:'#6366f1', text:`Top category: ${top[0]} with ${top[1]} leads` });

    return items.slice(0, 4);
  }, [leads, total, sent, replied, won, lost]);

  // Animated counters (only after data loads)
  const cTotal   = useCountUp(total,   !loading);
  const cSent    = useCountUp(sent,    !loading);
  const cActive  = useCountUp(active,  !loading);
  const cAvg     = useCountUp(avg,     !loading);

  function toast$(msg, ms = 3000) { setToast(msg); setTimeout(() => setToast(''), ms); }
  function openCompose(l) { const a = defaultAngle(l); setAngle(a); setCompose(l); setDraft(generateDraft(l, a)); }
  function regen(a) { const x = a ?? angle; setAngle(x); setDraft(generateDraft(compose, x)); }

  async function doSend(e) {
    e.preventDefault(); setSending(true);
    try {
      await sendEmail({ to: compose.email, subject: draft.subject, html: draft.body });
      await supabase.from('app_leads').update({ email_sent: true, last_contact: new Date().toISOString(), status: 'Contacted' }).eq('id', compose.id);
      setCompose(null); toast$(`✅ Email sent to ${compose.email}`); load();
    } catch (err) { alert('Send failed: ' + err.message); }
    finally { setSending(false); }
  }

  // Batch follow-up — send to all overdue leads
  async function sendBatchFollowup() {
    setBatchBusy(true);
    let count = 0;
    for (const l of needFollowup) {
      if (!l.email) continue;
      const d = generateDraft(l, defaultAngle(l));
      try {
        await sendEmail({ to: l.email, subject: d.subject, html: d.body });
        await supabase.from('app_leads').update({ email_sent: true, last_contact: new Date().toISOString() }).eq('id', l.id);
        count++;
      } catch {}
    }
    setBatchBusy(false);
    toast$(`✅ Sent ${count} follow-up email${count > 1 ? 's' : ''}`);
    load();
  }

  return (
    <Page title="Dashboard">
      {toast && <div className="alert alert-ok" style={{ marginBottom:16 }}>{toast}</div>}

      {/* Greeting banner */}
      <div className="greeting-banner">
        <div>
          <div className="greeting-text">{greeting(profile?.full_name || profile?.email)}</div>
          <div className="greeting-sub">
            {loading ? 'Loading your workspace…'
              : total === 0 ? 'Add your first lead to get started.'
              : goalDone ? `🎉 Daily goal hit! ${sentToday} emails sent today.`
              : `You have ${needFollowup.length} follow-up${needFollowup.length !== 1 ? 's' : ''} pending and ${strikeList.length} hot leads to email.`}
          </div>
        </div>
        {!loading && total > 0 && (
          <div style={{ display:'flex', gap:10 }}>
            <Link className="btn btn-primary btn-sm" to="/app/leads" style={{ textDecoration:'none' }}>View Leads →</Link>
          </div>
        )}
      </div>

      {loading ? <div className="center">Loading…</div> : (<>

        {/* KPI strip — animated counters */}
        <div className="stats">
          {[
            { cls:'blue',   label:'Total Leads',    value:cTotal,  sub:'in your workspace' },
            { cls:'green',  label:'Emails Sent',    value:cSent,   sub:`${replied} replied` },
            { cls:'orange', label:'Active Pipeline', value:cActive, sub:`${won} won` },
            { cls:'purple', label:'Avg Lead Score',  value:cAvg,    sub:'out of 100' },
          ].map((s) => (
            <div key={s.label} className={`stat ${s.cls}`}>
              <div className="label">{s.label}</div>
              <div className="value">{s.value}</div>
              <div className="sub">{s.sub}</div>
            </div>
          ))}
        </div>

        {/* Smart insights */}
        {insights.length > 0 && (
          <div className="insights-strip">
            {insights.map((ins, i) => (
              <div key={i} className="insight-pill" style={{ '--ins-color': ins.color }}>
                <span className="insight-ico">{ins.ico}</span>
                <span>{ins.text}</span>
              </div>
            ))}
          </div>
        )}

        {/* Goal + chart */}
        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:18 }}>
          <div className="card">
            <div className="card-head">
              <div>
                <h3>🎯 Today's Goal — {GOAL} Outreach</h3>
                <p style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>Email {GOAL} leads today to maximise closes</p>
              </div>
              <span style={{ fontSize:13, fontWeight:700, color: goalDone ? 'var(--green)' : 'var(--primary)' }}>
                {sentToday}/{GOAL} {goalDone ? '🎉' : ''}
              </span>
            </div>
            <div className="card-body">
              <div className="progress-track" style={{ marginBottom:14 }}>
                <div className="progress-bar" style={{ width: goalPct + '%', background: goalDone ? 'var(--green)' : 'var(--primary)' }} />
              </div>
              {strikeList.length === 0 ? (
                <div style={{ color:'var(--muted)', fontSize:13, textAlign:'center', padding:'10px 0' }}>
                  {goalDone ? '🎉 Goal hit! Check back tomorrow.' : 'No uncontacted leads with emails yet.'}
                </div>
              ) : (
                <div className="strike-list">
                  {strikeList.map((l) => (
                    <div key={l.id} className="strike-row">
                      <div className="strike-score" style={{ background: l.lead_score >= 80 ? '#fef3c7' : '#f0f9ff', color: l.lead_score >= 80 ? '#92400e' : '#0369a1' }}>
                        {l.lead_score}
                      </div>
                      <div style={{ flex:1, minWidth:0 }}>
                        <div style={{ fontWeight:700, fontSize:13, whiteSpace:'nowrap', overflow:'hidden', textOverflow:'ellipsis' }}>{l.company}</div>
                        <div style={{ fontSize:11, color:'var(--muted)' }}>
                          {l.country}{!l.website && <span style={{ marginLeft:6, color:'#f59e0b', fontWeight:600 }}>· No site</span>}
                        </div>
                      </div>
                      <button className="btn btn-sm btn-primary" style={{ flexShrink:0 }} onClick={() => openCompose(l)}>✍️</button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>📅 This Week's Activity</h3></div>
            <div className="card-body">
              <div className="mini-chart">
                {weekData.map((d) => (
                  <div key={d.day} className="mini-chart-col">
                    <div className="mini-bars">
                      <div className="mini-bar added"   style={{ height: Math.round((d.added   / chartMax) * 60) + 'px' }} title={`${d.added} added`} />
                      <div className="mini-bar emailed" style={{ height: Math.round((d.emailed / chartMax) * 60) + 'px' }} title={`${d.emailed} emailed`} />
                    </div>
                    <div className={`mini-day ${d.isToday ? 'today' : ''}`}>{d.day}</div>
                  </div>
                ))}
              </div>
              <div className="chart-legend">
                <span><span className="legend-dot" style={{ background:'var(--primary)', opacity:.8 }} /> Leads added</span>
                <span><span className="legend-dot" style={{ background:'var(--green)',   opacity:.8 }} /> Emailed</span>
              </div>
            </div>
          </div>
        </div>

        {/* Follow-up radar */}
        {needFollowup.length > 0 && (
          <div className="card" style={{ marginBottom:18 }}>
            <div className="card-head">
              <h3>⏰ Follow-up Radar — {needFollowup.length} waiting</h3>
              <button className="btn btn-sm" style={{ background:'#fff7ed', color:'#c2410c', border:'1px solid #fed7aa' }}
                onClick={sendBatchFollowup} disabled={batchBusy}>
                {batchBusy ? 'Sending…' : `🔁 Send all ${needFollowup.length} follow-ups`}
              </button>
            </div>
            <div className="card-body">
              {needFollowup.map((l) => {
                const days = Math.floor((Date.now() - new Date(l.last_contact)) / 86400000);
                return (
                  <div key={l.id} className="followup-row">
                    <div className="followup-days">{days}d</div>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:13 }}>{l.company}</div>
                      <div style={{ fontSize:11, color:'#92400e' }}>{l.email} · {l.country}</div>
                    </div>
                    <button className="btn btn-sm" style={{ background:'#fff7ed', color:'#c2410c', border:'1px solid #fed7aa' }}
                      onClick={() => openCompose(l)}>🔁 Follow up</button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Recent leads */}
        <div className="card">
          <div className="card-head"><h3>Recent leads</h3><Link className="btn btn-sm" to="/app/leads">View all →</Link></div>
          <div className="card-body" style={{ padding:0 }}>
            {total === 0 ? (
              <div className="empty">No leads yet. <Link className="muted-link" to="/app/leads">Add your first lead</Link> to get started.</div>
            ) : (
              <table>
                <thead><tr><th>Company</th><th>Contact / Email</th><th>Status</th><th style={{ textAlign:'center' }}>Score</th><th>Country</th></tr></thead>
                <tbody>
                  {leads.slice(0, 8).map((l) => (
                    <tr key={l.id}>
                      <td><b>{l.company}</b><div style={{ fontSize:11, color:'var(--muted)' }}>{l.category}</div></td>
                      <td>{l.contact || '—'}<div style={{ fontSize:11, color:'var(--muted)' }}>{l.email || extractPhone(l.notes) || '—'}</div></td>
                      <td>{statusPill(l.status)}{l.email_sent && <span title="emailed" style={{ marginLeft:4 }}>✉️</span>}</td>
                      <td style={{ textAlign:'center' }}>
                        <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}>{l.lead_score}</span>
                      </td>
                      <td style={{ fontSize:12, color:'var(--muted)' }}>{l.country}</td>
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
