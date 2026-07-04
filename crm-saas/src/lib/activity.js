// Immutable event log — every meaningful action on a lead writes one row
// here instead of mutating a single `notes` text blob. This is what backs
// the activity timeline in the lead detail drawer and lets Analytics compute
// real metrics from history instead of from a couple of booleans.

import { supabase } from './supabase';

// type: 'lead_created' | 'email_sent' | 'reply_logged' | 'stage_changed'
//     | 'note_added' | 'task_created' | 'task_completed' | 'sequence_started'
//     | 'sequence_paused' | 'sequence_completed'
export async function logActivity(orgId, leadId, type, payload = {}) {
  const { data: { user } } = await supabase.auth.getUser();
  return supabase.from('app_activities').insert({
    org_id: orgId,
    lead_id: leadId,
    type,
    payload,
    created_by: user?.id || null,
  });
}

export async function getTimeline(leadId) {
  const { data } = await supabase
    .from('app_activities')
    .select('*')
    .eq('lead_id', leadId)
    .order('created_at', { ascending: false });
  return data || [];
}

// Human-readable label + icon for each activity type, used by the timeline UI.
export const ACTIVITY_META = {
  lead_created:        { icon: '✨', label: (p) => `Lead created${p.source ? ` from ${p.source}` : ''}` },
  email_sent:          { icon: '📨', label: (p) => `Email sent${p.angle ? ` — ${p.angle} angle` : ''}${p.step != null ? ` (step ${p.step + 1})` : ''}` },
  reply_logged:        { icon: '↩️', label: (p) => `Reply logged — ${p.intent || 'unclassified'}` },
  stage_changed:       { icon: '🔀', label: (p) => `Stage: ${p.from || '—'} → ${p.to}` },
  note_added:          { icon: '📝', label: () => 'Note added' },
  task_created:        { icon: '📋', label: (p) => `Task created — due ${p.due_at ? new Date(p.due_at).toLocaleDateString() : ''}` },
  task_completed:      { icon: '✅', label: (p) => `Task completed${p.title ? ` — ${p.title}` : ''}` },
  sequence_started:    { icon: '▶️', label: (p) => `Enrolled in "${p.sequence_name || 'sequence'}"` },
  sequence_paused:     { icon: '⏸️', label: (p) => `Sequence paused${p.reason ? ` — ${p.reason}` : ''}` },
  sequence_completed:  { icon: '🏁', label: () => 'Sequence completed — no more steps' },
};
