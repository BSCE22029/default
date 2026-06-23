import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page, { Modal } from '../../components/Page';
import { useAuth } from '../../lib/AuthContext';

export default function Team() {
  const { profile, orgId, refreshProfile } = useAuth();
  const isAdmin = profile?.role === 'admin' || profile?.role === 'super_admin';
  const [org, setOrg] = useState(null);
  const [members, setMembers] = useState([]);
  const [orgName, setOrgName] = useState('');
  const [savedMsg, setSavedMsg] = useState('');
  const [invite, setInvite] = useState(null);
  const [inviteMsg, setInviteMsg] = useState('');

  async function load() {
    const [{ data: o }, { data: m }] = await Promise.all([
      supabase.from('app_orgs').select('*').eq('id', orgId).maybeSingle(),
      supabase.from('app_members').select('*').order('created_at'),
    ]);
    setOrg(o); setOrgName(o?.name || ''); setMembers(m || []);
  }
  useEffect(() => { if (orgId) load(); }, [orgId]);

  async function saveOrg() {
    await supabase.from('app_orgs').update({ name: orgName }).eq('id', orgId);
    setSavedMsg('Saved ✓'); setTimeout(() => setSavedMsg(''), 2000); load();
  }

  async function doInvite(e) {
    e.preventDefault();
    setInviteMsg('');
    const { data: { session } } = await supabase.auth.getSession();
    try {
      const res = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-member`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(invite),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Invite failed');
      setInvite(null); load();
    } catch (err) { setInviteMsg(err.message); }
  }

  if (!org && orgId) return <Page title="Team & Settings"><div className="center">Loading…</div></Page>;

  return (
    <Page title="Team & Settings">
      <div className="grid2">
        <div className="card">
          <div className="card-head"><h3>Workspace</h3>{savedMsg && <span style={{ color: 'var(--green)', fontSize: 12 }}>{savedMsg}</span>}</div>
          <div className="card-body">
            <div className="field"><label>Workspace name</label>
              <input value={orgName} onChange={(e) => setOrgName(e.target.value)} disabled={!isAdmin} />
            </div>
            <div className="field"><label>Plan</label><input value={org?.plan || 'free'} disabled /></div>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={saveOrg}>Save</button>}
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Members ({members.length})</h3>
            {isAdmin && <button className="btn btn-primary btn-sm" onClick={() => { setInvite({ email: '', full_name: '', password: '' }); setInviteMsg(''); }}>+ Invite</button>}
          </div>
          <div className="card-body" style={{ padding: 0 }}>
            <table>
              <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.user_id}>
                    <td>{m.full_name || '—'} {m.user_id === profile.user_id && <span style={{ fontSize: 11, color: 'var(--muted)' }}>(you)</span>}</td>
                    <td>{m.email}</td>
                    <td><span className="badge-role" style={{ background: '#eef2ff', color: '#4338ca' }}>{(m.role || '').replace('_', ' ')}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {invite && (
        <Modal title="Invite a teammate" onClose={() => setInvite(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setInvite(null)}>Cancel</button>
            <button className="btn btn-primary" form="invForm">Create member</button>
          </>}>
          <form id="invForm" onSubmit={doInvite}>
            {inviteMsg && <div className="alert alert-error">{inviteMsg}</div>}
            <div className="field"><label>Full name</label><input value={invite.full_name} onChange={(e) => setInvite({ ...invite, full_name: e.target.value })} required /></div>
            <div className="field"><label>Email</label><input type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} required /></div>
            <div className="field"><label>Temporary password</label><input value={invite.password} onChange={(e) => setInvite({ ...invite, password: e.target.value })} minLength={6} required /></div>
            <div className="alert alert-ok">They'll join <b>{org?.name}</b> as a member and can sign in immediately with this password.</div>
          </form>
        </Modal>
      )}
    </Page>
  );
}
