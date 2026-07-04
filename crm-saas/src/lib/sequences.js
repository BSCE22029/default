// Multi-step follow-up engine — this is the fix for the #1 root cause found
// in the CRM audit: previously there was exactly one email per lead, ever.
// A sequence is a list of steps ({ delay_days, angle }); enrolling a lead
// schedules step 0 immediately, and each successful send schedules the next
// step `delay_days` later. A reply of ANY kind pauses the cadence — a human
// conversation has started and the robot should get out of the way.
//
// IMPORTANT — this runs client-side (triggered by opening the Dashboard, or
// the "Run due follow-ups now" button) rather than on a server cron. That
// means it only fires while someone has the app open, not on a strict
// schedule. To get true unattended sending, this exact logic
// (`runDueSequenceSteps`) should be deployed as a scheduled Supabase Edge
// Function — the code is written so that porting it is a copy/paste job.

import { supabase, sendEmail } from './supabase';
import { generateDraft, defaultAngle } from './emailDraft';
import { logActivity } from './activity';

const SEND_THROTTLE_MS = 2500; // spacing between sends — see task #13 rationale

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

export async function getDefaultSequence(orgId) {
  const { data } = await supabase.from('app_sequences')
    .select('*').eq('org_id', orgId).eq('is_active', true)
    .order('created_at', { ascending: true }).limit(1).maybeSingle();
  return data;
}

export async function enrollInSequence(orgId, leadId, sequenceId) {
  // One active sequence per lead (enforced by a partial unique index too —
  // this check just avoids a noisy constraint-violation round trip).
  const { data: existing } = await supabase.from('app_lead_sequences')
    .select('id').eq('lead_id', leadId).eq('status', 'active').maybeSingle();
  if (existing) return { data: existing, error: null, alreadyEnrolled: true };

  const { data, error } = await supabase.from('app_lead_sequences').insert({
    org_id: orgId, lead_id: leadId, sequence_id: sequenceId,
    current_step: 0, next_send_at: new Date().toISOString(), status: 'active',
  }).select().single();

  if (!error) {
    const { data: seq } = await supabase.from('app_sequences').select('name').eq('id', sequenceId).single();
    await logActivity(orgId, leadId, 'sequence_started', { sequence_name: seq?.name });
  }
  return { data, error, alreadyEnrolled: false };
}

// Called the moment ANY reply is logged, regardless of intent — stops the
// automated cadence so a real conversation doesn't get a robotic follow-up
// email talked over it.
export async function pauseSequenceForLead(orgId, leadId, reason) {
  const { data: row } = await supabase.from('app_lead_sequences')
    .select('id').eq('lead_id', leadId).eq('status', 'active').maybeSingle();
  if (!row) return;
  await supabase.from('app_lead_sequences').update({ status: 'paused' }).eq('id', row.id);
  await logActivity(orgId, leadId, 'sequence_paused', { reason });
}

export async function stopSequenceForLead(leadId) {
  await supabase.from('app_lead_sequences')
    .update({ status: 'stopped' }).eq('lead_id', leadId).eq('status', 'active');
}

// The core automation: find every lead-sequence whose next step is due,
// send it, log it, and schedule (or complete) the following step.
// onProgress(done, total) lets callers show a progress bar.
export async function runDueSequenceSteps(orgId, onProgress) {
  const nowIso = new Date().toISOString();
  const { data: due, error } = await supabase
    .from('app_lead_sequences')
    .select('*, app_leads(*), app_sequences(name, steps)')
    .eq('org_id', orgId)
    .eq('status', 'active')
    .lte('next_send_at', nowIso);

  if (error || !due?.length) return { sent: 0, errors: 0, completed: 0, total: 0 };

  let sent = 0, errors = 0, completed = 0;
  for (let i = 0; i < due.length; i++) {
    const row = due[i];
    const lead = row.app_leads;
    const steps = row.app_sequences?.steps || [];
    const step = steps[row.current_step];

    if (!lead?.email || !step) {
      // Dead end (no email, or step data missing) — stop this lead's cadence
      // rather than retrying forever.
      await supabase.from('app_lead_sequences').update({ status: 'stopped' }).eq('id', row.id);
      onProgress?.(i + 1, due.length);
      continue;
    }

    const angle = step.angle === 'auto' ? defaultAngle(lead) : step.angle;
    const draft = generateDraft(lead, angle);

    try {
      await sendEmail({ to: lead.email, subject: draft.subject, html: draft.body });

      await supabase.from('app_messages').insert({
        org_id: orgId, lead_id: lead.id, direction: 'out',
        subject: draft.subject, body: draft.body, angle, sequence_step: row.current_step,
      });
      await supabase.from('app_leads').update({
        email_sent: true, last_contact: new Date().toISOString(),
        status: lead.status === 'New Lead' ? 'Contacted' : lead.status,
      }).eq('id', lead.id);
      await logActivity(orgId, lead.id, 'email_sent', { angle, step: row.current_step });

      const nextStep = row.current_step + 1;
      if (nextStep < steps.length) {
        const nextDue = new Date();
        nextDue.setDate(nextDue.getDate() + (steps[nextStep].delay_days || 0));
        await supabase.from('app_lead_sequences').update({
          current_step: nextStep, next_send_at: nextDue.toISOString(),
        }).eq('id', row.id);
      } else {
        await supabase.from('app_lead_sequences').update({ status: 'completed', next_send_at: null }).eq('id', row.id);
        await logActivity(orgId, lead.id, 'sequence_completed', {});
        completed++;
      }
      sent++;
    } catch {
      errors++;
    }

    onProgress?.(i + 1, due.length);
    if (i < due.length - 1) await sleep(SEND_THROTTLE_MS);
  }

  return { sent, errors, completed, total: due.length };
}

// How many lead-sequences are currently due — used to show a badge/count
// without actually sending anything (e.g. on Dashboard load).
export async function countDueSequenceSteps(orgId) {
  const { count } = await supabase
    .from('app_lead_sequences')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId).eq('status', 'active').lte('next_send_at', new Date().toISOString());
  return count || 0;
}
