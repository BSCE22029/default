// Real follow-up tasks — replaces the old "Follow-up Radar" pattern, which
// was just a computed filter (email_sent && 2+ days old) with no actual
// row, due date, or way to mark something done. Every task here is a real
// database object so "who do I contact today" is a query, not a guess.

import { supabase } from './supabase';
import { logActivity } from './activity';

export async function createTask(orgId, leadId, title, dueAt, assignedTo = null) {
  const { data: { user } } = await supabase.auth.getUser();
  const { data, error } = await supabase.from('app_tasks').insert({
    org_id: orgId,
    lead_id: leadId,
    title,
    due_at: dueAt,
    assigned_to: assignedTo || user?.id || null,
  }).select().single();
  if (!error) await logActivity(orgId, leadId, 'task_created', { title, due_at: dueAt });
  return { data, error };
}

export async function completeTask(task) {
  const { error } = await supabase.from('app_tasks')
    .update({ completed_at: new Date().toISOString() })
    .eq('id', task.id);
  if (!error) await logActivity(task.org_id, task.lead_id, 'task_completed', { title: task.title });
  return { error };
}

export async function snoozeTask(task, days = 1) {
  const next = new Date(task.due_at);
  next.setDate(next.getDate() + days);
  return supabase.from('app_tasks').update({ due_at: next.toISOString() }).eq('id', task.id);
}

// All open (not completed) tasks for an org, joined with lead company/email
// so the Tasks page and Dashboard queue don't need a second round-trip.
export async function listOpenTasks(orgId) {
  const { data, error } = await supabase
    .from('app_tasks')
    .select('*, app_leads(company, email, lead_score, status)')
    .eq('org_id', orgId)
    .is('completed_at', null)
    .order('due_at', { ascending: true });
  return { data: data || [], error };
}

export function taskUrgency(dueAt) {
  const days = (new Date(dueAt) - Date.now()) / 86400000;
  if (days < 0)   return 'overdue';
  if (days < 1)   return 'today';
  if (days < 3)   return 'soon';
  return 'later';
}

export const URGENCY_STYLE = {
  overdue: { bg: '#fef2f2', color: '#dc2626', border: '#fca5a5', label: 'Overdue' },
  today:   { bg: '#fffbeb', color: '#d97706', border: '#fde68a', label: 'Today' },
  soon:    { bg: '#eff6ff', color: '#2563eb', border: '#bfdbfe', label: 'Soon' },
  later:   { bg: '#f8fafc', color: '#64748b', border: '#e2e8f0', label: 'Upcoming' },
};
