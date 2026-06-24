import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

const NAV = [
  { ico:'📊', label:'Dashboard',        to:'/app',            hint:'d' },
  { ico:'👥', label:'Leads',             to:'/app/leads',      hint:'l' },
  { ico:'📋', label:'Pipeline',          to:'/app/pipeline',   hint:'p' },
  { ico:'⚡', label:'Lead Generator',    to:'/app/generator',  hint:'g' },
  { ico:'📈', label:'Analytics',         to:'/app/analytics',  hint:'a' },
  { ico:'⚙️', label:'Team & Settings',  to:'/app/team',       hint:'s' },
];

export default function CommandPalette({ onClose }) {
  const nav = useNavigate();
  const inputRef = useRef();
  const listRef  = useRef();
  const [q,     setQ]     = useState('');
  const [leads, setLeads] = useState([]);
  const [idx,   setIdx]   = useState(0);

  useEffect(() => {
    inputRef.current?.focus();
    supabase.from('app_leads').select('id,company,contact,email,lead_score,status').limit(300)
      .then(({ data }) => setLeads(data || []));
  }, []);

  const navItems = NAV.filter((n) => !q || n.label.toLowerCase().includes(q.toLowerCase()));
  const leadItems = q.length >= 2
    ? leads.filter((l) => [l.company, l.contact, l.email]
        .some((v) => (v||'').toLowerCase().includes(q.toLowerCase()))).slice(0, 6)
    : [];

  const all = [
    ...navItems.map((n) => ({ kind:'nav', ...n })),
    ...leadItems.map((l) => ({ kind:'lead', ...l })),
  ];

  useEffect(() => { setIdx(0); }, [q]);

  function select(item) {
    if (item.kind === 'nav') nav(item.to);
    else nav('/app/leads');
    onClose();
  }

  function onKey(e) {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => Math.min(i + 1, all.length - 1)); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === 'Enter' && all[idx]) select(all[idx]);
  }

  useEffect(() => {
    listRef.current?.children[idx]?.scrollIntoView({ block:'nearest' });
  }, [idx]);

  return (
    <div className="cp-overlay" onMouseDown={(e) => e.target.classList.contains('cp-overlay') && onClose()}>
      <div className="cp-box" role="dialog" aria-label="Command palette">
        <div className="cp-search-row">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{ flexShrink:0, color:'#64748b' }}>
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>
          </svg>
          <input
            ref={inputRef}
            className="cp-input"
            placeholder="Search leads or jump to a page…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={onKey}
            autoComplete="off"
          />
          <kbd className="cp-esc-key" onClick={onClose}>esc</kbd>
        </div>

        <div className="cp-list" ref={listRef}>
          {all.length === 0 && q && (
            <div className="cp-empty">No results for "{q}"</div>
          )}

          {navItems.length > 0 && (
            <>
              <div className="cp-group-label">{q ? 'Pages' : 'Quick navigation'}</div>
              {navItems.map((n, i) => (
                <div key={n.to} className={`cp-item ${idx === i ? 'cp-item-active' : ''}`}
                  onClick={() => select({ kind:'nav', ...n })}
                  onMouseEnter={() => setIdx(i)}>
                  <span className="cp-item-ico">{n.ico}</span>
                  <span className="cp-item-label">{n.label}</span>
                  {!q && <kbd className="cp-hint">{n.hint}</kbd>}
                </div>
              ))}
            </>
          )}

          {leadItems.length > 0 && (
            <>
              <div className="cp-group-label">Leads</div>
              {leadItems.map((l, i) => {
                const gi = navItems.length + i;
                const sc = l.lead_score || 0;
                return (
                  <div key={l.id} className={`cp-item ${idx === gi ? 'cp-item-active' : ''}`}
                    onClick={() => select({ kind:'lead', ...l })}
                    onMouseEnter={() => setIdx(gi)}>
                    <span className="cp-lead-ico">{(l.company||'?').slice(0,2).toUpperCase()}</span>
                    <span className="cp-item-label">
                      <b>{l.company}</b>
                      {l.email && <span className="cp-lead-email">{l.email}</span>}
                    </span>
                    <span className={`score-badge ${sc >= 80 ? 'hot' : sc >= 60 ? 'warm' : 'cold'}`} style={{ fontSize:11 }}>{sc}</span>
                  </div>
                );
              })}
            </>
          )}
        </div>

        <div className="cp-footer">
          <span><kbd>↑↓</kbd> navigate</span>
          <span><kbd>↵</kbd> open</span>
          <span><kbd>esc</kbd> close</span>
        </div>
      </div>
    </div>
  );
}
