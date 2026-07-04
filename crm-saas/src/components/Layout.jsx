import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../lib/AuthContext';
import { supabase } from '../lib/supabase';
import CommandPalette from './CommandPalette';
import {
  IconLayoutDashboard, IconUsers, IconColumns, IconBolt,
  IconChartBar, IconSettings, IconSatellite, IconBuilding,
  IconSun, IconMoon, IconSearch, IconArrowsExchange, IconChecklist,
} from '@tabler/icons-react';

const tenantNav = [
  { to: '/app',           end: true, Icon: IconLayoutDashboard, label: 'Dashboard'      },
  { to: '/app/leads',               Icon: IconUsers,            label: 'Leads'          },
  { to: '/app/tasks',               Icon: IconChecklist,        label: 'Tasks'          },
  { to: '/app/pipeline',            Icon: IconColumns,          label: 'Pipeline'       },
  { to: '/app/generator',           Icon: IconBolt,             label: 'Lead Generator' },
  { to: '/app/analytics',           Icon: IconChartBar,         label: 'Analytics'      },
  { to: '/app/team',                Icon: IconSettings,         label: 'Settings'       },
];

const adminNav = [
  { to: '/admin',      end: true, Icon: IconSatellite, label: 'Platform Overview' },
  { to: '/admin/orgs',            Icon: IconBuilding,  label: 'Organizations'    },
];

export default function Layout({ admin }) {
  const { profile, signOut } = useAuth();
  const nav   = useNavigate();
  const items = admin ? adminNav : tenantNav;
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark');
  const [cp,   setCp]   = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  }, [dark]);

  useEffect(() => {
    function handler(e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') { e.preventDefault(); setCp((o) => !o); }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const ch = supabase.channel('app-live').subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => supabase.removeChannel(ch);
  }, []);

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="dot" /> LeadFlow</div>

        {live && (
          <div style={{ display:'flex', alignItems:'center', gap:6, fontSize:11, color:'#4ade80', marginBottom:10, paddingLeft:4 }}>
            <span className="live-dot" /> Live
          </div>
        )}

        <nav>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
              <item.Icon size={17} stroke={1.75} className="ico" />
              {item.label}
            </NavLink>
          ))}
          {profile?.role === 'super_admin' && (
            <NavLink to={admin ? '/app' : '/admin'}>
              <IconArrowsExchange size={17} stroke={1.75} className="ico" />
              {admin ? 'Tenant view' : 'Admin console'}
            </NavLink>
          )}
        </nav>

        <button className="cp-trigger-btn" onClick={() => setCp(true)}>
          <IconSearch size={14} stroke={2} style={{ color:'#64748b', flexShrink:0 }} />
          <span style={{ flex:1, textAlign:'left', fontSize:12, color:'#64748b' }}>Search…</span>
          <kbd className="cp-trigger-kbd">⌘K</kbd>
        </button>

        <div className="who">
          <b>{profile?.full_name || profile?.email}</b>
          {profile?.email}
          <div className="badge-role">{(profile?.role || '').replace('_', ' ')}</div>
          <div style={{ display:'flex', gap:8, marginTop:12 }}>
            <button
              className="btn btn-ghost btn-sm"
              style={{ flex:1, color:'#94a3b8', borderColor:'#1e293b', display:'flex', alignItems:'center', justifyContent:'center' }}
              title={dark ? 'Light mode' : 'Dark mode'}
              onClick={() => setDark((d) => !d)}>
              {dark ? <IconSun size={14} stroke={2} /> : <IconMoon size={14} stroke={2} />}
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

      {cp && <CommandPalette onClose={() => setCp(false)} />}
    </div>
  );
}
