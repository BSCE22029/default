import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

const FUNNEL_STAGES = ['New Lead','Contacted','Qualified','Proposal Sent','Negotiation','Closed Won'];
const FUNNEL_COLORS = ['#6366f1','#3b82f6','#0ea5e9','#06b6d4','#f59e0b','#22c55e'];

export default function Analytics() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('app_leads').select('*').then(({ data }) => { setLeads(data || []); setLoading(false); });
  }, []);

  const total   = leads.length;
  const won     = leads.filter((l) => l.status === 'Closed Won').length;
  const sent    = leads.filter((l) => l.email_sent).length;
  const replied = leads.filter((l) => l.email_replied).length;
  const avg     = total ? Math.round(leads.reduce((s, l) => s + (l.lead_score || 0), 0) / total) : 0;
  const winRate   = total ? Math.round((won   / total) * 100) : 0;
  const replyRate = sent  ? Math.round((replied / sent) * 100) : 0;

  // Last 12 weeks trend
  const weekData = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 12 }, (_, i) => {
      const end   = new Date(today); end.setDate(today.getDate() - i * 7);
      const start = new Date(end);   start.setDate(end.getDate() - 6);
      const es = end.toISOString().split('T')[0];
      const ss = start.toISOString().split('T')[0];
      return {
        label: `W${12 - i}`,
        count: leads.filter((l) => { const d = l.created_at?.split('T')[0]; return d >= ss && d <= es; }).length,
      };
    }).reverse();
  }, [leads]);

  function groupBy(key) {
    const m = {};
    leads.forEach((l) => { const k = l[key] || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 8);
  }

  const funnel     = FUNNEL_STAGES.map((s, i) => ({ name: s, n: leads.filter((l) => l.status === s).length, color: FUNNEL_COLORS[i] }));
  const funnelMax  = Math.max(1, ...funnel.map((s) => s.n));
  const countries  = groupBy('country');
  const categories = groupBy('category');

  // SVG trend chart
  const W = 500, H = 100, PAD = 8;
  const trendMax = Math.max(1, ...weekData.map((w) => w.count));
  const pts = weekData.map((w, i) => ({
    x: PAD + (i / (weekData.length - 1)) * (W - PAD * 2),
    y: PAD + (1 - w.count / trendMax) * (H - PAD * 2),
  }));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${pts[pts.length - 1].x.toFixed(1)},${H} L${pts[0].x.toFixed(1)},${H} Z`;

  // Email donut
  const r = 38, circ = 2 * Math.PI * r, filled = (replyRate / 100) * circ;

  if (loading) return (
    <Page title="Analytics">
      <div className="stats">{[1,2,3,4].map((i) => <div key={i} className="stat skeleton" style={{ height:88 }} />)}</div>
      <div className="card skeleton" style={{ height:160, marginBottom:16 }} />
      <div className="grid2">
        <div className="card skeleton" style={{ height:280 }} />
        <div className="card skeleton" style={{ height:280 }} />
      </div>
    </Page>
  );

  return (
    <Page title="Analytics">
      {/* KPI strip */}
      <div className="stats" style={{ marginBottom:20 }}>
        {[
          { label:'Total Leads',   value:total,       sub:`${leads.filter((l)=>!['Closed Won','Closed Lost'].includes(l.status)).length} active`, color:'#6366f1' },
          { label:'Win Rate',      value:`${winRate}%`,  sub:`${won} closed won`,                     color:'#22c55e' },
          { label:'Reply Rate',    value:`${replyRate}%`, sub:`${replied} of ${sent} replied`,         color:'#3b82f6' },
          { label:'Avg Score',     value:avg,         sub:'out of 100',                              color:'#f59e0b' },
        ].map(({ label, value, sub, color }) => (
          <div key={label} className="stat" style={{ borderTop:`3px solid ${color}` }}>
            <div className="label">{label}</div>
            <div className="value" style={{ color }}>{value}</div>
            <div className="sub">{sub}</div>
          </div>
        ))}
      </div>

      {/* Trend chart */}
      <div className="card" style={{ marginBottom:16 }}>
        <div className="card-head">
          <h3>📈 Lead Volume — Last 12 Weeks</h3>
          <span style={{ fontSize:12, color:'var(--muted)' }}>
            {weekData.reduce((s, w) => s + w.count, 0)} leads this period
          </span>
        </div>
        <div className="card-body">
          <svg viewBox={`0 0 ${W} ${H}`} style={{ width:'100%', height:100 }} preserveAspectRatio="none">
            <defs>
              <linearGradient id="aGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%"   stopColor="#6366f1" stopOpacity="0.25" />
                <stop offset="100%" stopColor="#6366f1" stopOpacity="0.02" />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#aGrad)" />
            <path d={line} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {pts.map((p, i) => (
              <circle key={i} cx={p.x} cy={p.y} r="3.5" fill="#6366f1" />
            ))}
          </svg>
          <div style={{ display:'flex', justifyContent:'space-between', fontSize:10, color:'var(--muted)', marginTop:6 }}>
            {weekData.map((w) => <span key={w.label}>{w.label}</span>)}
          </div>
        </div>
      </div>

      {/* Funnel + Email perf */}
      <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:16, marginBottom:16 }}>
        {/* Conversion funnel */}
        <div className="card">
          <div className="card-head"><h3>📊 Conversion Funnel</h3></div>
          <div className="card-body">
            {funnel.map((s, i) => {
              const pct  = total > 0 ? Math.round((s.n / total) * 100) : 0;
              const conv = i > 0 && funnel[i-1].n > 0 ? Math.round((s.n / funnel[i-1].n) * 100) : null;
              return (
                <div key={s.name} style={{ marginBottom:16 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:5 }}>
                    <span style={{ fontWeight:600 }}>{s.name}</span>
                    <span style={{ color:'var(--muted)' }}>
                      <b style={{ color:'var(--text)' }}>{s.n}</b> · {pct}%
                      {conv !== null && (
                        <span style={{ marginLeft:8, fontWeight:700,
                          color: conv >= 50 ? '#22c55e' : conv >= 25 ? '#f59e0b' : '#ef4444' }}>
                          ↓{conv}%
                        </span>
                      )}
                    </span>
                  </div>
                  <div className="progress-track" style={{ height:8 }}>
                    <div className="progress-bar" style={{ width:`${(s.n / funnelMax) * 100}%`, height:'100%', background:s.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Email performance */}
        <div className="card">
          <div className="card-head"><h3>✉️ Email Performance</h3></div>
          <div className="card-body" style={{ display:'flex', alignItems:'center', gap:28 }}>
            <svg width="96" height="96" viewBox="0 0 96 96" style={{ flexShrink:0 }}>
              <circle cx="48" cy="48" r={r} fill="none" stroke="var(--border)" strokeWidth="10" />
              <circle cx="48" cy="48" r={r} fill="none" stroke="#3b82f6" strokeWidth="10"
                strokeDasharray={`${filled} ${circ}`}
                strokeDashoffset={circ / 4}
                strokeLinecap="round"
                style={{ transition:'stroke-dasharray .7s ease' }} />
              <text x="48" y="53" textAnchor="middle" fontSize="17" fontWeight="800" fill="var(--text)">{replyRate}%</text>
            </svg>
            <div style={{ flex:1 }}>
              {[
                { label:'Emails sent',      value:sent,                                           color:'var(--primary)' },
                { label:'Replies',           value:replied,                                        color:'#22c55e' },
                { label:'Pending reply',     value:sent - replied,                                color:'#f59e0b' },
                { label:'Not yet emailed',   value:leads.filter((l) => l.email && !l.email_sent).length, color:'var(--muted)' },
              ].map(({ label, value, color }) => (
                <div key={label} style={{ display:'flex', justifyContent:'space-between', marginBottom:10, fontSize:13 }}>
                  <span style={{ color:'var(--muted)' }}>{label}</span>
                  <span style={{ fontWeight:800, color }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Countries + categories */}
      <div className="grid2">
        {[
          { title:'🌍 Top Countries', data:countries },
          { title:'🏷️ Leads by Category', data:categories },
        ].map(({ title, data }) => (
          <div key={title} className="card">
            <div className="card-head"><h3>{title}</h3></div>
            <div className="card-body">
              {data.length === 0 ? <div className="empty">No data yet</div> : data.map((d, i) => (
                <div key={d.k} style={{ marginBottom:10 }}>
                  <div style={{ display:'flex', justifyContent:'space-between', fontSize:12, marginBottom:4 }}>
                    <span style={{ fontWeight:500 }}>{d.k}</span>
                    <span style={{ color:'var(--muted)' }}>{d.n}</span>
                  </div>
                  <div className="progress-track" style={{ height:6 }}>
                    <div className="progress-bar" style={{
                      width:`${(d.n / (data[0]?.n || 1)) * 100}%`, height:'100%',
                      background: i < 3 ? 'var(--primary)' : '#a5b4fc',
                    }} />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Page>
  );
}
