import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

const STAGES = ['New Lead','Contacted','Qualified','Proposal Sent','Negotiation','Closed Won','Closed Lost'];
const STAGE_META = {
  'New Lead':      { color:'#6366f1', bg:'#eef2ff' },
  'Contacted':     { color:'#0ea5e9', bg:'#f0f9ff' },
  'Qualified':     { color:'#8b5cf6', bg:'#f5f3ff' },
  'Proposal Sent': { color:'#f59e0b', bg:'#fffbeb' },
  'Negotiation':   { color:'#f97316', bg:'#fff7ed' },
  'Closed Won':    { color:'#22c55e', bg:'#f0fdf4' },
  'Closed Lost':   { color:'#94a3b8', bg:'#f8fafc' },
};

export default function Pipeline() {
  const [leads,    setLeads]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [drag,     setDrag]     = useState(null);
  const [dragOver, setDragOver] = useState(null);

  async function load() {
    const { data } = await supabase.from('app_leads').select('*').order('lead_score', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function moveTo(stage) {
    if (!drag || drag.status === stage) { setDrag(null); setDragOver(null); return; }
    setLeads((ls) => ls.map((l) => l.id === drag.id ? { ...l, status: stage } : l));
    await supabase.from('app_leads').update({ status: stage }).eq('id', drag.id);
    setDrag(null); setDragOver(null);
  }

  const active = leads.filter((l) => !['Closed Won','Closed Lost'].includes(l.status)).length;
  const won    = leads.filter((l) => l.status === 'Closed Won').length;
  const lost   = leads.filter((l) => l.status === 'Closed Lost').length;

  return (
    <Page title="Pipeline">
      {loading ? <div className="center">Loading…</div> : (<>

        {/* Summary strip */}
        <div style={{ display:'flex', marginBottom:20, background:'var(--card)', borderRadius:12, border:'1px solid var(--border)', overflow:'hidden' }}>
          {[
            { label:'Total Leads',     value:leads.length, color:'var(--text)' },
            { label:'Active Pipeline', value:active,       color:'#6366f1'     },
            { label:'Closed Won',      value:won,          color:'#22c55e'     },
            { label:'Closed Lost',     value:lost,         color:'#94a3b8'     },
          ].map(({ label, value, color }, i, arr) => (
            <div key={label} style={{ flex:1, padding:'14px 20px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.03em', marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:26, fontWeight:800, color }}>{value}</div>
            </div>
          ))}
          <div style={{ flex:2, padding:'14px 20px', display:'flex', alignItems:'center' }}>
            <span style={{ fontSize:12, color:'var(--muted)' }}>Drag cards between columns to move a lead's stage.</span>
          </div>
        </div>

        {/* Kanban board */}
        <div className="kanban">
          {STAGES.map((stage) => {
            const items  = leads.filter((l) => l.status === stage);
            const { color, bg } = STAGE_META[stage];
            const isOver = dragOver === stage;
            return (
              <div key={stage} className="kcol"
                style={{ borderTop:`3px solid ${color}`, background: isOver ? bg : undefined, transition:'background .15s' }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(stage); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => moveTo(stage)}>

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:10, padding:'2px 4px' }}>
                  <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', color }}>{stage}</span>
                  <span style={{ fontSize:11, fontWeight:700, padding:'1px 8px', background:color+'22', color, borderRadius:20 }}>{items.length}</span>
                </div>

                {items.map((l) => (
                  <div key={l.id} className="kcard"
                    style={{ opacity: drag?.id === l.id ? 0.45 : 1, transition:'opacity .15s' }}
                    draggable
                    onDragStart={() => setDrag(l)}
                    onDragEnd={() => { setDrag(null); setDragOver(null); }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', marginBottom:4 }}>
                      <b style={{ fontSize:13, lineHeight:1.3 }}>{l.company}</b>
                      <span className={`score-badge ${l.lead_score >= 80 ? 'hot' : l.lead_score >= 60 ? 'warm' : 'cold'}`}
                        style={{ fontSize:10, padding:'2px 6px', marginLeft:6, flexShrink:0 }}>
                        {l.lead_score}
                      </span>
                    </div>
                    {l.contact && <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>{l.contact}</div>}
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {l.category    && <span className="tag">{l.category}</span>}
                      {l.country     && <span className="tag">{l.country}</span>}
                      {l.email_sent  && <span className="tag tag-blue">✉️</span>}
                      {l.email_replied && <span className="tag tag-green">↩ Replied</span>}
                    </div>
                  </div>
                ))}

                {items.length === 0 && (
                  <div className={`kcol-empty ${isOver ? 'kcol-empty-over' : ''}`}
                    style={{ borderColor: isOver ? color : undefined, color: isOver ? color : undefined }}>
                    {isOver ? '📥 Drop here' : 'Empty'}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </>)}
    </Page>
  );
}
