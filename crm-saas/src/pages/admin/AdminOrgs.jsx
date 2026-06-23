import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

export default function AdminOrgs() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: orgs }, { data: members }, { data: leads }] = await Promise.all([
      supabase.from('app_orgs').select('*').order('created_at', { ascending: false }),
      supabase.from('app_members').select('org_id'),
      supabase.from('app_leads').select('org_id'),
    ]);
    const count = (arr, id) => arr.filter((x) => x.org_id === id).length;
    setRows((orgs || []).map((o) => ({
      ...o,
      members: count(members || [], o.id),
      leads: count(leads || [], o.id),
    })));
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function toggleStatus(o) {
    const next = o.status === 'active' ? 'suspended' : 'active';
    await supabase.from('app_orgs').update({ status: next }).eq('id', o.id);
    load();
  }

  async function removeOrg(o) {
    if (!confirm(`Delete "${o.name}" and ALL its leads/members? This cannot be undone.`)) return;
    await supabase.from('app_orgs').delete().eq('id', o.id); // cascades
    load();
  }

  return (
    <Page title="Organizations">
      <div className="card">
        <div className="card-body" style={{ padding: 0, overflowX: 'auto' }}>
          {loading ? <div className="empty">Loading…</div> :
            rows.length === 0 ? <div className="empty">No organizations yet.</div> : (
            <table>
              <thead><tr><th>Organization</th><th>Plan</th><th>Members</th><th>Leads</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody>
                {rows.map((o) => (
                  <tr key={o.id}>
                    <td><b>{o.name}</b></td>
                    <td>{o.plan}</td>
                    <td>{o.members}</td>
                    <td>{o.leads}</td>
                    <td><span className={`pill ${o.status === 'active' ? 'pill-won' : 'pill-lost'}`}>{o.status}</span></td>
                    <td style={{ fontSize: 12, color: 'var(--muted)' }}>{new Date(o.created_at).toLocaleDateString()}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <button className="btn btn-sm btn-ghost" onClick={() => toggleStatus(o)}>{o.status === 'active' ? 'Suspend' : 'Activate'}</button>{' '}
                      <button className="btn btn-sm btn-danger" onClick={() => removeOrg(o)}>Delete</button>
                    </td>
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
