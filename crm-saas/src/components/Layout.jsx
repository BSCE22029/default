import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';

const tenantNav = [
  { to: '/app',            end: true, ico: '📊', label: 'Dashboard'       },
  { to: '/app/leads',                ico: '👥', label: 'Leads'            },
  { to: '/app/pipeline',             ico: '📋', label: 'Pipeline'         },
  { to: '/app/generator',            ico: '⚡', label: 'Lead Generator'   },
  { to: '/app/analytics',            ico: '📈', label: 'Analytics'        },
  { to: '/app/team',                 ico: '⚙️', label: 'Team & Settings'  },
];

const adminNav = [
  { to: '/admin',      end: true, ico: '🛰️', label: 'Platform Overview' },
  { to: '/admin/orgs',            ico: '🏢', label: 'Organizations'     },
];

export default function Layout({ admin }) {
  const { profile, signOut } = useAuth();
  const nav   = useNavigate();
  const items = admin ? adminNav : tenantNav;
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> LeadFlow</div>
        <nav>
          {items.map((i) => (
            <NavLink key={i.to} to={i.to} end={i.end}
              className={({ isActive }) => (isActive ? 'active' : '')}>
              <span className="ico">{i.ico}</span> {i.label}
            </NavLink>
          ))}
          {profile?.role === 'super_admin' && (
            <NavLink to={admin ? '/app' : '/admin'}>
              <span className="ico">↔️</span> {admin ? 'Tenant view' : 'Admin console'}
            </NavLink>
          )}
        </nav>
        <div className="who">
          <b>{profile?.full_name || profile?.email}</b>
          {profile?.email}
          <div className="badge-role">{(profile?.role || '').replace('_', ' ')}</div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex:1, color:'#94a3b8', borderColor:'#1e293b' }}
              title={dark ? 'Light mode' : 'Dark mode'}
              onClick={() => setDark((d) => !d)}>
              {dark ? '☀️' : '🌙'}
            </button>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex:2, color:'#cbd5e1', borderColor:'#1e293b' }}
              onClick={async () => { await signOut(); nav('/login'); }}>
              Sign out
            </button>
          </div>
        </div>
      </aside>
      <div className="main">
        <Outlet />
      </div>
    </div>
  );
}
