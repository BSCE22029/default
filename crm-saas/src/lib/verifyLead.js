// Genuine-client verification — proves a lead is a real, reachable business
// using free, key-less public infrastructure:
//
//   1. DNS A/AAAA record  (DNS-over-HTTPS: Google → Cloudflare fallback)
//      → the company's domain actually resolves; site isn't parked vapor.
//   2. DNS MX record      → the domain can RECEIVE email; outreach will deliver
//      instead of bouncing. Strongest cheap signal that a lead is contactable.
//   3. RDAP registration  (rdap.org) → domain age. A domain registered years
//      ago is an established business; weeks ago is unproven (or a scam).
//   4. Liveness probe     (no-cors fetch) → the website answers HTTP right now.
//   5. Email hygiene      → contact email on the company's own domain beats
//      freemail (gmail/yahoo) which anyone can register in minutes.
//
// Output: genuine_score 0–100, verdict, human-readable reasons.
//   ≥75 GENUINE · ≥55 LIKELY · ≥35 UNVERIFIED · <35 RISKY

const FREEMAIL = new Set([
  'gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'live.com',
  'aol.com', 'icloud.com', 'proton.me', 'protonmail.com', 'mail.com',
  'yandex.com', 'zoho.com', 'gmx.com',
]);

export function domainOf(input) {
  if (!input) return '';
  const s = String(input).trim();
  const raw = s.includes('@')
    ? s.split('@').pop()
    : s.replace(/^https?:\/\//, '').split('/')[0];
  const d = raw.replace(/^www\./, '').toLowerCase().split(':')[0];
  return d.includes('.') ? d : '';
}

async function doh(name, type) {
  const endpoints = [
    `https://dns.google/resolve?name=${encodeURIComponent(name)}&type=${type}`,
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(name)}&type=${type}`,
  ];
  for (const url of endpoints) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/dns-json' } });
      if (!r.ok) continue;
      const d = await r.json();
      return Array.isArray(d.Answer) ? d.Answer : [];
    } catch { /* try next resolver */ }
  }
  return null; // both resolvers unreachable — unknown, not "no records"
}

async function domainAgeYears(domain) {
  try {
    const r = await fetch(`https://rdap.org/domain/${encodeURIComponent(domain)}`);
    if (!r.ok) return null;
    const d = await r.json();
    const reg = (d.events || []).find((e) => e.eventAction === 'registration');
    if (!reg?.eventDate) return null;
    return (Date.now() - new Date(reg.eventDate).getTime()) / 31557600000;
  } catch { return null; }
}

async function siteAnswers(url, timeoutMs = 6000) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    // no-cors: an opaque response still proves the server answered.
    await fetch(url, { mode: 'no-cors', signal: ctrl.signal });
    clearTimeout(t);
    return true;
  } catch { return false; }
}

export async function verifyLead(lead) {
  const webDomain   = domainOf(lead.website);
  const emailDomain = domainOf(lead.email);
  const domain      = webDomain || emailDomain;

  if (!domain) {
    return {
      score: lead.registered ? 35 : 15,
      verdict: lead.registered ? 'UNVERIFIED' : 'RISKY',
      reasons: lead.registered
        ? ['No domain to verify, but company is in an official registry']
        : ['No website or email domain — cannot verify this business exists'],
    };
  }

  // Guard: if the ONLY domain we have is a freemail provider, the DNS/MX/age
  // checks would measure Google/Yahoo's legitimacy — not this lead's. A business
  // reachable only at a gmail address is inherently unproven, so cap it low and
  // skip the infrastructure checks (they'd give a false GENUINE).
  if (!webDomain && FREEMAIL.has(emailDomain)) {
    const corroborated = lead.registered || lead.companyNumber || lead.phone;
    return {
      score: corroborated ? 40 : 25,
      verdict: corroborated ? 'UNVERIFIED' : 'RISKY',
      reasons: [
        'No company website — only a free email address (gmail/yahoo/etc.)',
        'Cannot confirm this is a real business; anyone can create a freemail account',
        corroborated ? 'Some corroboration (registry / phone) — treat as a lead to qualify' : '',
      ].filter(Boolean),
    };
  }

  const [aRec, mxRec, age, alive] = await Promise.all([
    doh(domain, 'A'),
    doh(domain, 'MX'),
    domainAgeYears(domain),
    siteAnswers(lead.website || `https://${domain}`),
  ]);

  let score = 0;
  const reasons = [];

  // 1. Domain resolves (25)
  if (aRec === null)          { score += 12; reasons.push('DNS check unavailable'); }
  else if (aRec.length)       { score += 25; reasons.push('Domain resolves — real infrastructure'); }
  else                        { reasons.push('Domain does NOT resolve — likely dead or fake'); }

  // 2. Mail exchanger (25) — the single best "outreach will land" signal
  if (mxRec === null)         { score += 10; reasons.push('MX check unavailable'); }
  else if (mxRec.length)      { score += 25; reasons.push('MX records live — email will deliver'); }
  else                        { reasons.push('No MX records — emails to this domain will bounce'); }

  // 3. Domain age (20)
  if (age === null)           { score += 6;  reasons.push('Registration date unknown'); }
  else if (age >= 3)          { score += 20; reasons.push(`Established domain — ${Math.floor(age)}+ years old`); }
  else if (age >= 1)          { score += 14; reasons.push('Domain 1–3 years old — young but real'); }
  else                        { score += 6;  reasons.push('Domain under 1 year old — unproven'); }

  // 4. Site answers HTTP (10)
  if (alive)                  { score += 10; reasons.push('Website is up right now'); }
  else                        { reasons.push('Website did not answer (may block probes)'); }

  // 5. Email hygiene (10)
  if (emailDomain && webDomain && emailDomain === webDomain) {
    score += 10; reasons.push('Contact email on company’s own domain');
  } else if (emailDomain && FREEMAIL.has(emailDomain)) {
    reasons.push('Freemail contact address — weak identity signal');
  } else if (emailDomain) {
    score += 6; reasons.push('Email domain differs from website');
  } else {
    reasons.push('No contact email yet');
  }

  // 6. Corroboration (10): official registry entry, phone, or named contact
  let extra = 0;
  if (lead.registered || lead.companyNumber) extra += 5;
  if (lead.phone || lead.contact)            extra += 5;
  if (extra) { score += extra; reasons.push('Corroborated by registry / phone / named contact'); }

  score = Math.max(0, Math.min(100, score));
  const verdict = score >= 75 ? 'GENUINE' : score >= 55 ? 'LIKELY' : score >= 35 ? 'UNVERIFIED' : 'RISKY';
  return { score, verdict, reasons };
}

// Verify a batch with limited concurrency; onProgress(doneCount) streams UI updates.
export async function verifyLeads(leads, onProgress, batchSize = 6) {
  for (let i = 0; i < leads.length; i += batchSize) {
    await Promise.all(leads.slice(i, i + batchSize).map(async (l) => {
      const v = await verifyLead(l);
      l.genuine_score   = v.score;
      l.genuine         = v.verdict;
      l.genuine_reasons = v.reasons;
    }));
    onProgress?.(Math.min(i + batchSize, leads.length));
  }
  return leads;
}

// Final ranking: being real and reachable outweighs topical fit.
export function genuineRank(l) {
  const fit = l.ai_score ?? l.lead_score ?? 55;
  const gen = l.genuine_score ?? 40;
  return gen * 0.6 + fit * 0.4;
}
