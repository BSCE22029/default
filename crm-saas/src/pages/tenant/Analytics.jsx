import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

function Bars({ title, data }) {
  const max = Math.max(1, ...data.map((d) => d.n));
  return (
    <div className="card">
      <div className="card-head"><h3>{title}</h3></div>
      <div className="card-body">
        {data.length === 0 ? <div className="empty">No data yet</div> : data.map((d) => (
          <div className="bar-row" key={d.k}>
            <span className="lbl">{d.k}</span>
            <span className="bar-track"><span className="bar-fill" style={{ width: `${(d.n / max) * 100}%` }} /></span>
            <span className="num">{d.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Analytics() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('app_leads').select('*').then(({ data }) => { setLeads(data || []); setLoading(false); });
  }, []);

  const groupBy = (key) => {
    const m = {};
    leads.forEach((l) => { const k = l[key] || '—'; m[k] = (m[k] || 0) + 1; });
    return Object.entries(m).map(([k, n]) => ({ k, n })).sort((a, b) => b.n - a.n).slice(0, 10);
  };

  const funnel = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Closed Won']
    .map((k) => ({ k, n: leads.filter((l) => l.status === k).length }));

  return (
    <Page title="Analytics">
      {loading ? <div className="center">Loading…</div> : (
        <div className="grid2">
          <Bars title="Pipeline funnel" data={funnel} />
          <Bars title="Leads by category" data={groupBy('category')} />
          <Bars title="Leads by country" data={groupBy('country')} />
          <Bars title="Leads by industry" data={groupBy('industry')} />
        </div>
      )}
    </Page>
  );
}
