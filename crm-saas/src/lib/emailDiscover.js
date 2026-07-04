// Real email discovery — finds addresses a company ACTUALLY publishes,
// instead of guessing info@domain (which bounces ~95% of the time).
//
// Strategy, per company, best-source-wins:
//   1. Scrape the company's own pages (home, /contact, /about, /team …)
//      through a free CORS reader proxy, and extract:
//        · mailto: hrefs   (highest confidence — a real, clickable address)
//        · plain-text emails on the page
//   2. Keep only addresses on the company's own domain (or a close variant),
//      drop tracking/asset/placeholder junk.
//   3. Rank: role prefixes we can act on (contact/hello/sales/info) first,
//      then any on-domain personal address.
//   4. If nothing is found, fall back to a single guessed info@ — clearly
//      flagged as a guess so you never mistake it for verified.
//
// No API key required. Uses public proxies with graceful fallback.

import { domainFromWebsite } from './emailGuess';

export const EMAIL_RE   = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
export const EMAIL_FULL = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;
// Invisible chars (zero-width space/joiners, line/para separators, nbsp, BOM)
// built from code points so no literal invisibles live in this source file.
const INVISIBLE = new RegExp('[' + [0x200b, 0x200c, 0x200d, 0x2028, 0x2029, 0x00a0, 0xfeff].map((c) => '\\u' + c.toString(16).padStart(4, '0')).join('') + ']', 'g');

// Addresses that are never a real human contact.
const JUNK = [
  /\.(png|jpg|jpeg|gif|svg|webp|css|js|woff2?)$/i,
  /@(sentry|wixpress|example|domain|email|yourdomain)\b/i,
  /^(no-?reply|donotreply|postmaster|mailer-daemon|abuse)/i,
  /(@2x|@3x)/i,                       // retina image refs like logo@2x.png
  /u003|x00/i,                        // escaped junk from JSON blobs
];

// Prefixes worth reaching out to, best first.
const GOOD_PREFIX = ['contact', 'hello', 'hi', 'sales', 'info', 'team', 'business', 'partnerships', 'careers', 'jobs', 'support'];

export function isJunk(e) { return JUNK.some((re) => re.test(e)); }

// Normalize a raw match: strip URL-encoding, invisible chars, and any
// leading/trailing punctuation that regex/HTML dragged in.
export function cleanEmail(raw) {
  let e = raw;
  try { e = decodeURIComponent(e); } catch { /* keep as-is */ }
  return e
    .replace(INVISIBLE, '')
    .trim()
    .toLowerCase()
    .replace(/^[^a-z0-9]+/, '')       // leading junk before local part
    .replace(/[).,;:>'"\]]+$/, '');   // trailing punctuation/brackets
}

export function rootDomain(d) {
  const parts = d.split('.');
  return parts.length > 2 ? parts.slice(-2).join('.') : d;
}

function scoreEmail(email, domain) {
  const [local, dom] = email.split('@');
  const onDomain = dom === domain || rootDomain(dom) === rootDomain(domain);
  const prefixIdx = GOOD_PREFIX.indexOf(local);
  let s = 0;
  if (onDomain) s += 100;                       // same company domain = trust
  if (prefixIdx >= 0) s += 40 - prefixIdx;      // actionable role address
  if (!onDomain) s -= 60;                        // off-domain = probably a vendor
  return s;
}

// Fetch a URL's text through public reader/CORS proxies (first that works).
export async function readPage(url, timeoutMs = 8000) {
  const proxies = [
    (u) => `https://r.jina.ai/${u}`,                                      // clean markdown/text
    (u) => `https://api.allorigins.win/raw?url=${encodeURIComponent(u)}`, // raw HTML
  ];
  for (const build of proxies) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      const r = await fetch(build(url), { signal: ctrl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const text = await r.text();
      if (text && text.length > 50) return text;
    } catch { /* next proxy */ }
  }
  return '';
}

export function extractEmails(text, domain) {
  if (!text) return [];
  const found = new Set();
  const add = (raw) => {
    const e = cleanEmail(raw);
    if (e.includes('@') && EMAIL_FULL.test(e) && !isJunk(e)) found.add(e);
  };
  // mailto: hrefs — highest confidence
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) add(m[1]);
  // plain-text and obfuscated ("name [at] domain [dot] com")
  const deobf = text
    .replace(/\s*\[?\(?\s*at\s*\)?\]?\s*/gi, '@')
    .replace(/\s*\[?\(?\s*dot\s*\)?\]?\s*/gi, '.');
  for (const m of (deobf.match(EMAIL_RE) || [])) add(m);

  return [...found]
    .filter((e) => e.length < 60)
    .map((e) => ({ email: e, score: scoreEmail(e, domain) }))
    .sort((a, b) => b.score - a.score);
}

// Discover the best real email for ONE company.
// Returns { email, source:'scraped'|'github'|'provided'|'guessed', confidence, all[] } or null.
export async function discoverEmail(lead) {
  // Some sources already carry a real, non-guessed address (Apollo, Hunter, GitHub org email).
  if (lead.email && !/^info@/.test(lead.email) && lead.email.includes('@')) {
    return { email: lead.email, source: lead._source === 'GitHub' ? 'github' : 'provided', confidence: 'medium', all: [lead.email] };
  }

  const domain = domainFromWebsite(lead.website);
  if (!domain || !domain.includes('.') || domain.includes('github.com')) {
    return lead.email ? { email: lead.email, source: 'guessed', confidence: 'low', all: [lead.email] } : null;
  }

  const base = `https://${domain}`;
  const pages = [base, `${base}/contact`, `${base}/contact-us`, `${base}/about`, `${base}/about-us`];

  const hits = new Map(); // email -> best score
  for (const url of pages) {
    const text = await readPage(url);
    for (const { email, score } of extractEmails(text, domain)) {
      if (!hits.has(email) || score > hits.get(email)) hits.set(email, score);
    }
    if ([...hits.values()].some((s) => s >= 120)) break; // strong on-domain hit — stop early
  }

  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1]).map(([e]) => e);
  if (ranked.length && hits.get(ranked[0]) > 0) {
    return { email: ranked[0], source: 'scraped', confidence: 'high', all: ranked.slice(0, 5) };
  }
  return { email: `info@${domain}`, source: 'guessed', confidence: 'low', all: [`info@${domain}`] };
}

// Batch with limited concurrency; onProgress(done, total) streams UI updates.
// Returns a map: company(lowercased) -> discovery result.
export async function discoverEmails(leads, onProgress, batchSize = 4) {
  const out = {};
  const targets = leads.filter((l) => l.website || (l.email && l.email.includes('@')));
  for (let i = 0; i < targets.length; i += batchSize) {
    await Promise.all(targets.slice(i, i + batchSize).map(async (l) => {
      const res = await discoverEmail(l);
      if (res) out[l.company.toLowerCase()] = res;
    }));
    onProgress?.(Math.min(i + batchSize, targets.length), targets.length);
  }
  return out;
}
