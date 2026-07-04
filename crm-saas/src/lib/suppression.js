// Opt-out list — once an address unsubscribes, nothing in the CRM should
// ever email it again. Checked before every send (manual, bulk, and
// sequence-driven) so a suppressed contact can't accidentally get re-added
// to a future campaign and re-emailed.

import { supabase } from './supabase';

export async function isSuppressed(orgId, email) {
  if (!email) return false;
  const { data } = await supabase.from('app_suppressed_emails')
    .select('id').eq('org_id', orgId).eq('email', email.toLowerCase().trim()).maybeSingle();
  return !!data;
}

export async function suppress(orgId, email, reason = 'unsubscribed') {
  if (!email) return;
  await supabase.from('app_suppressed_emails')
    .upsert({ org_id: orgId, email: email.toLowerCase().trim(), reason }, { onConflict: 'org_id,email' });
}

// Filters a list of leads down to ones that are actually safe to email.
export async function filterSuppressed(orgId, leads) {
  const { data } = await supabase.from('app_suppressed_emails').select('email').eq('org_id', orgId);
  const blocked = new Set((data || []).map((r) => r.email));
  return leads.filter((l) => !blocked.has((l.email || '').toLowerCase().trim()));
}
