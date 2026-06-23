import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page from '../../components/Page';

const STAGES = ['New Lead', 'Contacted', 'Qualified', 'Proposal Sent', 'Negotiation', 'Closed Won', 'Closed Lost'];

export default function Pipeline() {
  const [leads, setLeads] = useState([]);
  const [loading, setLoading] = useState(true);
  const [drag, setDrag] = useState(null);

  async function load() {
    const { data } = await supabase.from('app_leads').select('*').order('lead_score', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function moveTo(stage) {
    if (!drag || drag.status === stage) return;
    setLeads((ls) => ls.map((l) => (l.id === drag.id ? { ...l, status: stage } : l))); // optimistic
    await supabase.from('app_leads').update({ status: stage }).eq('id', drag.id);
    setDrag(null);
  }

  return (
    <Page title="Pipeline">
      {loading ? <div className="center">Loading…</div> : (
        <div className="kanban">
          {STAGES.map((stage) => {
            const items = leads.filter((l) => l.status === stage);
            return (
              <div key={stage} className="kcol"
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => moveTo(stage)}>
                <h4>{stage} · {items.length}</h4>
                {items.map((l) => (
                  <div key={l.id} className="kcard" draggable
                    onDragStart={() => setDrag(l)}>
                    <b>{l.company}</b>
                    <div className="meta">{l.contact || '—'} · score {l.lead_score}</div>
                    <div className="meta">{l.opportunity_size || ''}</div>
                  </div>
                ))}
                {items.length === 0 && <div style={{ fontSize: 11, color: '#94a3b8', padding: '4px' }}>Drop here</div>}
              </div>
            );
          })}
        </div>
      )}
      <p className="sub" style={{ marginTop: 14, color: 'var(--muted)' }}>Drag cards between columns to update a lead's stage.</p>
    </Page>
  );
}
