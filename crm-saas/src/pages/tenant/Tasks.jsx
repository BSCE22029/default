import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Page from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';
import { listOpenTasks, completeTask, snoozeTask, taskUrgency, URGENCY_STYLE } from '../../lib/tasks';

const FILTERS = [
  { id:'all',     label:'All' },
  { id:'overdue', label:'Overdue' },
  { id:'today',   label:'Today' },
  { id:'soon',    label:'Soon' },
  { id:'later',   label:'Upcoming' },
];

export default function Tasks() {
  const { orgId } = useAuth();
  const [tasks,   setTasks]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter,  setFilter]  = useState('all');

  async function load() {
    if (!orgId) return;
    setLoading(true);
    const { data } = await listOpenTasks(orgId);
    setTasks(data);
    setLoading(false);
  }
  useEffect(() => { load(); }, [orgId]);

  const counts = tasks.reduce((acc, t) => {
    const u = taskUrgency(t.due_at);
    acc[u] = (acc[u] || 0) + 1;
    return acc;
  }, {});

  const visible = filter === 'all' ? tasks : tasks.filter((t) => taskUrgency(t.due_at) === filter);

  async function finish(t) {
    await completeTask(t);
    setTasks((ts) => ts.filter((x) => x.id !== t.id));
  }

  async function push(t, days) {
    await snoozeTask(t, days);
    load();
  }

  return (
    <Page title="Tasks">
      <div className="filter-chips" style={{ marginBottom:16 }}>
        {FILTERS.map((f) => (
          <button key={f.id} className={`chip ${filter === f.id ? 'active' : ''}`} onClick={() => setFilter(f.id)}>
            {f.label}{f.id !== 'all' && counts[f.id] ? <span className="chip-count">{counts[f.id]}</span> : null}
          </button>
        ))}
      </div>

      <div className="card">
        <div className="card-body" style={{ padding:0 }}>
          {loading ? (
            <div style={{ padding:24 }}>
              {[1,2,3].map((i) => <div key={i} className="skeleton" style={{ height:44, marginBottom:8, borderRadius:8 }} />)}
            </div>
          ) : visible.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize:40, marginBottom:12 }}>✅</div>
              <div style={{ fontWeight:600, marginBottom:6 }}>Nothing here</div>
              <div style={{ fontSize:13, color:'var(--muted)' }}>
                Tasks are created automatically whenever you send an email or enroll a lead in a sequence.
              </div>
            </div>
          ) : (
            <table>
              <thead>
                <tr><th>Urgency</th><th>Task</th><th>Lead</th><th>Due</th><th style={{ width:200 }}></th></tr>
              </thead>
              <tbody>
                {visible.map((t) => {
                  const urgency = taskUrgency(t.due_at);
                  const style = URGENCY_STYLE[urgency];
                  const lead = t.app_leads;
                  return (
                    <tr key={t.id}>
                      <td><span style={{ fontSize:11, fontWeight:800, padding:'3px 9px', borderRadius:20, background:style.bg, color:style.color, border:`1px solid ${style.border}` }}>{style.label}</span></td>
                      <td style={{ fontWeight:600, fontSize:13 }}>{t.title}</td>
                      <td style={{ fontSize:13 }}>
                        {lead ? (
                          <>
                            <Link className="muted-link" to="/app/leads">{lead.company}</Link>
                            <div style={{ fontSize:11, color:'var(--muted)' }}>{lead.email}</div>
                          </>
                        ) : '—'}
                      </td>
                      <td style={{ fontSize:12, color:'var(--muted)' }}>{new Date(t.due_at).toLocaleDateString('en-GB', { day:'numeric', month:'short', year:'numeric' })}</td>
                      <td style={{ whiteSpace:'nowrap' }}>
                        <button className="btn btn-sm" style={{ background:'#f0fdf4', color:'#166534', marginRight:4 }} onClick={() => finish(t)}>✓ Done</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => push(t, 1)}>+1d</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => push(t, 3)}>+3d</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Page>
  );
}
