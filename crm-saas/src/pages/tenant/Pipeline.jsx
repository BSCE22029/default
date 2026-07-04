import { useEffect, useState } from 'react';
import { supabase } from '../../lib/supabase';
import Page, { Modal } from '../../components/Page';
import { burst } from '../../lib/confetti';
import { logActivity } from '../../lib/activity';
import { stopSequenceForLead } from '../../lib/sequences';

const LOST_REASONS = [
  'No budget', 'Bad timing', 'No response after follow-ups', 'Went with a competitor',
  'Not a decision-maker', 'Not interested (reply)', 'Wrong contact', 'Other',
];

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

// Parse "$50K–$200K" → average dollar value
function parseRevenue(str) {
  if (!str) return 0;
  const re = /\$?([\d.,]+)\s*([KkMmBb]?)/g;
  const nums = [];
  let m;
  while ((m = re.exec(str)) !== null) {
    let n = parseFloat(m[1].replace(/,/g, ''));
    if (!n) continue;
    const u = m[2].toLowerCase();
    if (u === 'k') n *= 1000;
    else if (u === 'm') n *= 1e6;
    else if (u === 'b') n *= 1e9;
    nums.push(n);
  }
  return nums.length ? nums.reduce((s, v) => s + v, 0) / nums.length : 0;
}

function fmtRev(n) {
  if (!n) return null;
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
  if (n >= 1000) return '$' + Math.round(n / 1000) + 'K';
  return '$' + Math.round(n);
}

export default function Pipeline() {
  const [leads,    setLeads]    = useState([]);
  const [loading,  setLoading]  = useState(true);
  const [drag,     setDrag]     = useState(null);
  const [dragOver, setDragOver] = useState(null);
  const [wonAnim,  setWonAnim]  = useState(false);
  const [lostPrompt, setLostPrompt] = useState(null); // lead pending a Closed Lost drop
  const [lostReason, setLostReason] = useState(LOST_REASONS[0]);

  async function load() {
    const { data } = await supabase.from('app_leads').select('*').order('lead_score', { ascending: false });
    setLeads(data || []); setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function commitMove(lead, stage, extra = {}) {
    setLeads((ls) => ls.map((l) => l.id === lead.id ? { ...l, status: stage, ...extra } : l));
    await supabase.from('app_leads').update({ status: stage, ...extra }).eq('id', lead.id);
    await logActivity(lead.org_id, lead.id, 'stage_changed', { from: lead.status, to: stage });
    if (stage === 'Closed Won' || stage === 'Closed Lost') await stopSequenceForLead(lead.id);
    if (stage === 'Closed Won') {
      burst();
      setWonAnim(true);
      setTimeout(() => setWonAnim(false), 2800);
    }
  }

  async function moveTo(stage) {
    if (!drag || drag.status === stage) { setDrag(null); setDragOver(null); return; }
    // A drop into Closed Lost without a reason is exactly how loss analytics
    // die — gate it behind a required reason instead of silently flipping status.
    if (stage === 'Closed Lost' && !drag.lost_reason) {
      setLostReason(LOST_REASONS[0]);
      setLostPrompt(drag);
      setDrag(null); setDragOver(null);
      return;
    }
    const lead = drag;
    setDrag(null); setDragOver(null);
    await commitMove(lead, stage);
  }

  async function confirmLostReason() {
    if (!lostPrompt) return;
    await commitMove(lostPrompt, 'Closed Lost', { lost_reason: lostReason });
    setLostPrompt(null);
  }

  const active = leads.filter((l) => !['Closed Won','Closed Lost'].includes(l.status)).length;
  const won    = leads.filter((l) => l.status === 'Closed Won').length;
  const lost   = leads.filter((l) => l.status === 'Closed Lost').length;
  const wr     = won + lost > 0 ? Math.round((won / (won + lost)) * 100) : null;

  // Total estimated pipeline value (active stages only)
  const pipelineValue = leads
    .filter((l) => !['Closed Won','Closed Lost'].includes(l.status))
    .reduce((s, l) => s + parseRevenue(l.opportunity_size), 0);

  return (
    <Page title="Pipeline">
      {loading ? <div className="center">Loading…</div> : (<>

        {/* Closed Won celebration banner */}
        {wonAnim && (
          <div className="won-banner">
            🏆 Deal closed! Keep it up!
          </div>
        )}

        {/* Summary strip */}
        <div style={{ display:'flex', marginBottom:20, background:'var(--card)', borderRadius:12, border:'1px solid var(--border)', overflow:'hidden' }}>
          {[
            { label:'Total Leads',      value:leads.length,           color:'var(--text)' },
            { label:'Active Pipeline',  value:active,                 color:'#6366f1'     },
            { label:'Closed Won',       value:won,                    color:'#22c55e'     },
            { label:'Closed Lost',      value:lost,                   color:'#94a3b8'     },
          ].map(({ label, value, color }, i, arr) => (
            <div key={label} style={{ flex:1, padding:'14px 20px', borderRight: i < arr.length - 1 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ fontSize:11, color:'var(--muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'.03em', marginBottom:4 }}>{label}</div>
              <div style={{ fontSize:26, fontWeight:800, color }}>{value}</div>
            </div>
          ))}
          <div style={{ flex:2, padding:'14px 20px', display:'flex', flexDirection:'column', justifyContent:'center', gap:6 }}>
            {pipelineValue > 0 && (
              <div style={{ fontSize:13 }}>
                <span style={{ color:'var(--muted)', fontSize:11, fontWeight:600, textTransform:'uppercase', letterSpacing:'.03em' }}>Est. pipeline value</span>
                <div style={{ fontSize:20, fontWeight:800, color:'#6366f1' }}>{fmtRev(pipelineValue)}</div>
              </div>
            )}
            {wr !== null && (
              <div style={{ fontSize:12, color:'var(--muted)' }}>
                Win rate: <b style={{ color: wr >= 60 ? '#22c55e' : 'var(--text)' }}>{wr}%</b>
              </div>
            )}
            {!pipelineValue && <span style={{ fontSize:12, color:'var(--muted)' }}>Drag cards between columns to move a lead's stage.</span>}
          </div>
        </div>

        {/* Kanban board */}
        <div className="kanban">
          {STAGES.map((stage) => {
            const items    = leads.filter((l) => l.status === stage);
            const { color, bg } = STAGE_META[stage];
            const isOver   = dragOver === stage;
            const stageRev = items.reduce((s, l) => s + parseRevenue(l.opportunity_size), 0);
            return (
              <div key={stage} className="kcol"
                style={{ borderTop:`3px solid ${color}`, background: isOver ? bg : undefined, transition:'background .15s' }}
                onDragOver={(e) => { e.preventDefault(); setDragOver(stage); }}
                onDragLeave={() => setDragOver(null)}
                onDrop={() => moveTo(stage)}>

                <div style={{ marginBottom:10, padding:'2px 4px' }}>
                  <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
                    <span style={{ fontSize:11, fontWeight:700, textTransform:'uppercase', letterSpacing:'.04em', color }}>{stage}</span>
                    <span style={{ fontSize:11, fontWeight:700, padding:'1px 8px', background:color+'22', color, borderRadius:20 }}>{items.length}</span>
                  </div>
                  {stageRev > 0 && (
                    <div style={{ fontSize:10, color:'var(--muted)', marginTop:3, fontWeight:600 }}>
                      {fmtRev(stageRev)} est.
                    </div>
                  )}
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
                    {l.opportunity_size && (
                      <div style={{ fontSize:11, color:'#6366f1', fontWeight:700, marginBottom:5 }}>{l.opportunity_size}</div>
                    )}
                    <div style={{ display:'flex', gap:4, flexWrap:'wrap' }}>
                      {l.category      && <span className="tag">{l.category}</span>}
                      {l.country       && <span className="tag">{l.country}</span>}
                      {l.email_sent    && <span className="tag tag-blue">✉️</span>}
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

      {lostPrompt && (
        <Modal title={`Why is ${lostPrompt.company} lost?`} onClose={() => setLostPrompt(null)}
          footer={<>
            <button className="btn btn-ghost" onClick={() => setLostPrompt(null)}>Cancel</button>
            <button className="btn btn-primary" style={{ background:'#dc2626' }} onClick={confirmLostReason}>Move to Closed Lost</button>
          </>}>
          <div style={{ fontSize:13, color:'var(--muted)', marginBottom:12 }}>
            A reason is required — this is the only way loss analytics ever become useful.
          </div>
          <select value={lostReason} onChange={(e) => setLostReason(e.target.value)} style={{ width:'100%' }}>
            {LOST_REASONS.map((r) => <option key={r}>{r}</option>)}
          </select>
        </Modal>
      )}
    </Page>
  );
}
