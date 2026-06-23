import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

export default function AdminHome() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    (async () => {
      const [{ data: orgs }, { data: members }, { count: leadCount }] = await Promise.all([
        supabase.from('app_orgs').select('*').order('created_at', { ascending: false }),
        supabase.from('app_members').select('user_id, role'),
        supabase.from('app_leads').select('*', { count: 'exact', head: true }),
      ]);
      setStats({
        orgs: orgs || [],
        users: (members || []).length,
        admins: (members || []).filter((m) => m.role === 'admin').length,
        leads: leadCount || 0,
      });
    })();
  }, []);

  if (!stats) return <Page title="Platform Overview"><div className="center">Loading…</div></Page>;

  return (
    <Page title="Platform Overview">
      <div className="stats">
        <div className="stat blue"><div className="label">Organizations</div><div className="value">{stats.orgs.length}</div><div className="sub">{stats.orgs.filter((o) => o.status === 'active').length} active</div></div>
        <div className="stat green"><div className="label">Total Users</div><div className="value">{stats.users}</div><div className="sub">{stats.admins} tenant admins</div></div>
        <div className="stat purple"><div className="label">Total Leads</div><div className="value">{stats.leads}</div><div className="sub">across all tenants</div></div>
        <div className="stat orange"><div className="label">Avg Leads / Org</div><div className="value">{stats.orgs.length ? Math.round(stats.leads / stats.orgs.length) : 0}</div><div className="sub">platform-wide</div></div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Newest organizations</h3><Link className="btn btn-sm" to="/admin/orgs">Manage all →</Link></div>
        <div className="card-body" style={{ padding: 0 }}>
          {stats.orgs.length === 0 ? <div className="empty">No tenants yet.</div> : (
            <table>
              <thead><tr><th>Organization</th><th>Plan</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>
                {stats.orgs.slice(0, 8).map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.name}</b></td>
                    <td>{o.plan}</td>
                    <td><span className={`pill ${o.status === 'active' ? 'pill-won' : 'pill-lost'}`}>{o.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Page>
  );
}
