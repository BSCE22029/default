import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const SEND_FN = import.meta.env.VITE_SEND_FN;

// Send an email through the shared Supabase Edge Function (Gmail SMTP).
export async function sendEmail({ to, subject, html }) {
  const res = await fetch(SEND_FN, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to, subject, html }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || 'Send failed');
  return data;
}
