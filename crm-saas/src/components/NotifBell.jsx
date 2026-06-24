import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';

export default function NotifBell() {
  const [open,   setOpen]   = useState(false);
  const [notifs, setNotifs] = useState([]);
  const ref = useRef();

  useEffect(() => {
    async function calc() {
      const { data } = await supabase
        .from('app_leads')
        .select('lead_score,email_sent,email_replied,last_contact,status,created_at');
      if (!data) return;
      const today = new Date().toISOString().split('T')[0];
      const items = [];

      const overdue = data.filter((l) => {
        if (!l.email_sent || !l.last_contact) return false;
        const days = (Date.now() - new Date(l.last_contact)) / 86400000;
        return days >= 3 && ['Contacted', 'Qualified'].includes(l.status);
      });
      if (overdue.length)
        items.push({ ico:'⏰', text:`${overdue.length} follow-up${overdue.length > 1 ? 's' : ''} overdue (3+ days since email)`, type:'warn' });

      const hot = data.filter((l) => l.lead_score >= 80 && !l.email_sent);
      if (hot.length)
        items.push({ ico:'🔥', text:`${hot.length} hot lead${hot.length > 1 ? 's' : ''} (score ≥80) not yet emailed`, type:'hot' });

      const newToday = data.filter((l) => (l.created_at || '').startsWith(today));
      if (newToday.length)
        items.push({ ico:'✨', text:`${newToday.length} new lead${newToday.length > 1 ? 's' : ''} added today`, type:'info' });

      const replied = data.filter((l) => l.email_replied);
      if (replied.length)
        items.push({ ico:'↩', text:`${replied.length} lead${replied.length > 1 ? 's' : ''} replied to your outreach`, type:'success' });

      const inNego = data.filter((l) => l.status === 'Negotiation');
      if (inNego.length)
        items.push({ ico:'💰', text:`${inNego.length} deal${inNego.length > 1 ? 's' : ''} in Negotiation — close this week`, type:'deal' });

      setNotifs(items);
    }
    calc();
  }, []);

  // close on outside click
  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false); }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const TYPE_COLOR = { warn:'#f59e0b', hot:'#ef4444', info:'#6366f1', success:'#22c55e', deal:'#8b5cf6' };

  return (
    <div ref={ref} style={{ position:'relative' }}>
      <button
        onClick={() => setOpen((o) => !o)}
        title="Notifications"
        style={{
          width:36, height:36, borderRadius:10,
          background: open ? 'var(--bg)' : 'transparent',
          border:'1.5px solid ' + (open ? 'var(--border)' : 'transparent'),
          cursor:'pointer', fontSize:17,
          display:'flex', alignItems:'center', justifyContent:'center',
          position:'relative', transition:'all .15s',
        }}
      >
        🔔
        {notifs.length > 0 && (
          <span style={{
            position:'absolute', top:2, right:2,
            width:15, height:15, background:'#ef4444', borderRadius:'50%',
            fontSize:9, color:'#fff', fontWeight:800,
            display:'flex', alignItems:'center', justifyContent:'center',
            border:'2px solid var(--card)',
          }}>
            {notifs.length}
          </span>
        )}
      </button>

      {open && (
        <div className="notif-dropdown">
          <div className="notif-head">Notifications</div>
          {notifs.length === 0 ? (
            <div className="notif-empty">You're all caught up 🎉</div>
          ) : notifs.map((n, i) => (
            <div key={i} className="notif-item">
              <span className="notif-ico" style={{ color: TYPE_COLOR[n.type] }}>{n.ico}</span>
              <span style={{ fontSize:13, lineHeight:1.4 }}>{n.text}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
