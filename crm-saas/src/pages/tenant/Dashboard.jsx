import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Page, { statusPill } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';

export default function Dashboard() {
  const { profile } = useAuth();
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.from('app_leads').select('*').order('created_at', { ascending: false })
      .then(({ data }) => { setLeads(data || []); setLoading(false); });
  }, []);

  const total = leads.length;
  const sent = leads.filter((l) => l.email_sent).length;
  const replied = leads.filter((l) => l.email_replied).length;
  const won = leads.filter((l) => l.status === 'Closed Won').length;
  const active = leads.filter((l) => !['Closed Won', 'Closed Lost'].includes(l.status)).length;
  const avg = total ? Math.round(leads.reduce((s, l) => s + (l.lead_score || 0), 0) / total) : 0;

  return (
    <Page title="Dashboard">
      {loading ? <div className="center">Loading…</div> : (
        <>
          <div className="stats">
            <div className="stat blue"><div className="label">Total Leads</div><div className="value">{total}</div><div className="sub">in your workspace</div></div>
            <div className="stat green"><div className="label">Emails Sent</div><div className="value">{sent}</div><div className="sub">{replied} replied</div></div>
            <div className="stat orange"><div className="label">Active Pipeline</div><div className="value">{active}</div><div className="sub">{won} won</div></div>
            <div className="stat purple"><div className="label">Avg Lead Score</div><div className="value">{avg}</div><div className="sub">out of 100</div></div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Recent leads</h3><Link className="btn btn-sm" to="/app/leads">View all →</Link></div>
            <div className="card-body" style={{ padding: 0 }}>
              {total === 0 ? (
                <div className="empty">
                  No leads yet. <Link className="muted-link" to="/app/leads">Add your first lead</Link> to get started.
                </div>
              ) : (
                <table>
                  <thead><tr><th>Company</th><th>Contact</th><th>Status</th><th>Score</th></tr></thead>
                  <tbody>
                    {leads.slice(0, 8).map((l) => (
                      <tr key={l.id}>
                        <td><b>{l.company}</b><div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.category}</div></td>
                        <td>{l.contact}<div style={{ fontSize: 11, color: 'var(--muted)' }}>{l.email}</div></td>
                        <td>{statusPill(l.status)}</td>
                        <td><b>{l.lead_score}</b></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
