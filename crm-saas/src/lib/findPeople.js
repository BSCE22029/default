// Person-level lead finding — "like Apollo": real named decision-makers
// with a plausible personal email, not just a role inbox.
//
// How Apollo actually does this (no paid API, same technique):
//   1. Scrape the company's own about/team/leadership pages for names + titles.
//   2. Look at any REAL email already found on the domain (mailto links,
//      scraped addresses) and reverse-engineer the company's email pattern
//      from it — e.g. peter.lever@comvex.ai → pattern is {first}.{last}.
//   3. Apply that exact pattern to every other named person found, so
//      "Jane Smith, Co-Founder" becomes jane.smith@comvex.ai.
//   4. If no real email exists to learn the pattern from, fall back to the
//      2 most common patterns industry-wide and mark them as unconfirmed
//      guesses rather than pretending they're verified.
//   5. Rank people by seniority — founders/CEOs first — since those are
//      the highest-value contacts for outreach.
//
// No API key required; uses the same free reader proxies as emailDiscover.js.

import { domainFromWebsite } from './emailGuess';
import { readPage, extractEmails, cleanEmail, rootDomain } from './emailDiscover';

// Seniority — lower rank = higher value contact = shown first.
const TITLE_RANK = [
  [/\b(founder|co-?founder)\b/i, 0],
  [/\b(chief executive|ceo)\b/i, 1],
  [/\b(president|owner|managing director)\b/i, 1],
  [/\b(cto|coo|cfo|chief \w+ officer)\b/i, 2],
  [/\b(vp|vice president)\b/i, 3],
  [/\bhead of\b/i, 3],
  [/\b(director)\b/i, 4],
  [/\b(principal|partner)\b/i, 4],
  [/\b(lead\b|manager)\b/i, 5],
  [/\b(engineer|developer|designer|marketer|analyst|consultant)\b/i, 6],
];

function seniorityRank(title) {
  if (!title) return 9;
  for (const [re, rank] of TITLE_RANK) if (re.test(title)) return rank;
  return 7;
}

// Phrases that match the Title-Case-name regex but are never a person.
const NAME_STOPLIST = new Set([
  'privacy policy', 'terms of', 'all rights', 'read more', 'contact us',
  'learn more', 'view all', 'case study', 'our team', 'about us', 'get started',
  'sign up', 'log in', 'sign in', 'book a', 'get in touch', 'united states',
  'united kingdom', 'new york', 'los angeles', 'san francisco', 'get a quote',
  'terms conditions', 'cookie policy', 'follow us', 'meet the', 'our story',
]);

// Two- or three-word Title Case sequences that look like "First Last" or
// "First M. Last". Deliberately conservative to keep false positives low.
const NAME_RE = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Z]\.)?\s+[A-Z][a-zà-ÿ'-]+)\b/g;

// Case-SENSITIVE title check: real job titles are capitalized ("Co-Founder",
// "Partner"). Narrative sentences use the same words lowercase ("we partner
// with…"). Requiring a capital first letter on the match is what keeps
// ordinary prose from being mistaken for a title.
const TITLE_CASED_RE = /\b(Founder|Co-Founder|CEO|Chief Executive(?: Officer)?|President|Owner|Managing Director|CTO|COO|CFO|Chief \w+ Officer|VP|Vice President|Head of [A-Z][A-Za-z]+|Director|Principal|Partner|Manager|Team Lead|Engineer|Designer|Marketer|Analyst|Consultant)\b/;

function looksLikeRealName(name) {
  const lower = name.toLowerCase();
  if (NAME_STOPLIST.has(lower)) return false;
  if (name.split(/\s+/).length > 3) return false;
  if (/\d/.test(name)) return false;
  const common = ['The', 'This', 'That', 'From', 'With', 'Home', 'Menu', 'Page', 'Blog', 'News', 'Shop', 'Free', 'New', 'Who', 'Why', 'What', 'How'];
  if (common.includes(name.split(' ')[0])) return false;
  return true;
}

function stripHtmlIfNeeded(text) {
  if (/<\/?(html|div|body|span|section)[\s>]/i.test(text.slice(0, 2000))) {
    return text.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ');
  }
  return text;
}

// Pull {name, title} pairs out of a page's text. A name is only accepted if
// a properly-capitalized title sits on the SAME short line or the very next
// line — the layout of an actual team card — not just "somewhere nearby",
// which is what let unrelated headings and partner-logos steal titles.
function extractPeople(rawText) {
  const text = stripHtmlIfNeeded(rawText).replace(/\r/g, '');
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const found = new Map(); // lower-name -> { name, title, rank }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.length > 70) continue; // team-card lines are short; paragraphs aren't names
    const names = [...line.matchAll(NAME_RE)].map((m) => m[1].trim());
    if (!names.length) continue;

    const nextLine = lines[i + 1] && lines[i + 1].length <= 70 ? lines[i + 1] : '';
    const sameLineTitle = line.match(TITLE_CASED_RE);
    const nextLineTitle = !sameLineTitle && nextLine ? nextLine.match(TITLE_CASED_RE) : null;
    const titleMatchSrc = sameLineTitle ? line : nextLineTitle ? nextLine : null;
    if (!titleMatchSrc) continue; // no properly-capitalized title touching this name — skip

    for (const name of names) {
      if (!looksLikeRealName(name)) continue;
      if (titleMatchSrc.toLowerCase().includes(name.toLowerCase())) continue; // title text swallowed the "name" match
      const title = titleMatchSrc.length <= 60 ? titleMatchSrc : (sameLineTitle || nextLineTitle)[0];
      const key = name.toLowerCase();
      const rank = seniorityRank(title);
      const prev = found.get(key);
      if (!prev || rank < prev.rank) found.set(key, { name, title, rank });
    }
  }
  return [...found.values()].sort((a, b) => a.rank - b.rank);
}

// ── Email pattern detection ────────────────────────────────────────────────

const PATTERNS = {
  'first.last':  (f, l) => `${f}.${l}`,
  'first':       (f, l) => `${f}`,
  'flast':       (f, l) => `${f[0]}${l}`,
  'firstlast':   (f, l) => `${f}${l}`,
  'first_last':  (f, l) => `${f}_${l}`,
  'f.last':      (f, l) => `${f[0]}.${l}`,
  'last.first':  (f, l) => `${l}.${f}`,
};
// Most common patterns across real companies, in likelihood order — used
// only when we have no evidence to learn the real pattern from.
const DEFAULT_ORDER = ['first.last', 'first', 'flast', 'firstlast'];

function splitName(fullName) {
  const parts = fullName.trim().split(/\s+/).filter((p) => !/^[A-Z]\.?$/.test(p)); // drop middle initials
  if (parts.length < 2) return null;
  return { first: parts[0].toLowerCase(), last: parts[parts.length - 1].toLowerCase() };
}

// Given real on-domain personal emails and the people we found, figure out
// which naming pattern the company actually uses.
function detectPattern(personalEmails, people) {
  const votes = {};
  for (const email of personalEmails) {
    const local = email.split('@')[0];
    for (const person of people) {
      const parts = splitName(person.name);
      if (!parts) continue;
      for (const [id, fn] of Object.entries(PATTERNS)) {
        if (fn(parts.first, parts.last) === local) votes[id] = (votes[id] || 0) + 1;
      }
    }
  }
  const ranked = Object.entries(votes).sort((a, b) => b[1] - a[1]);
  return ranked.length ? ranked[0][0] : null;
}

function isRoleLocal(local) {
  return ['info', 'contact', 'hello', 'hi', 'sales', 'support', 'admin', 'team', 'careers', 'jobs', 'press', 'media', 'billing'].includes(local);
}

// ── Main export ─────────────────────────────────────────────────────────────

// Find real named people at a company, each with a best-guess email built
// from the company's actual (or most likely) email pattern.
// Returns [{ name, title, email, confidence: 'pattern-matched'|'pattern-guess', alt_emails[] }]
export async function findPeople(lead, maxPeople = 5) {
  const domain = domainFromWebsite(lead.website);
  if (!domain || !domain.includes('.') || domain.includes('github.com')) return [];

  const base = `https://${domain}`;
  const pages = [`${base}/about`, `${base}/about-us`, `${base}/team`, `${base}/our-team`, `${base}/leadership`, base];

  let allText = '';
  const personalEmails = new Set();
  let people = [];

  for (const url of pages) {
    const text = await readPage(url);
    if (!text) continue;
    allText += '\n' + text;
    for (const { email } of extractEmails(text, domain)) {
      const [local, dom] = email.split('@');
      if ((dom === domain || rootDomain(dom) === rootDomain(domain)) && !isRoleLocal(local)) {
        personalEmails.add(email);
      }
    }
    people = extractPeople(allText);
    if (people.length >= maxPeople && personalEmails.size > 0) break; // enough signal — stop scraping
  }

  if (!people.length) return [];

  const pattern = detectPattern([...personalEmails], people);
  const top = people.slice(0, maxPeople);

  return top.map((p) => {
    const parts = splitName(p.name);
    if (!parts) return { ...p, email: '', confidence: 'unknown', alt_emails: [] };

    if (pattern) {
      const email = `${PATTERNS[pattern](parts.first, parts.last)}@${domain}`;
      return { name: p.name, title: p.title, email, confidence: 'pattern-matched', pattern, alt_emails: [email] };
    }
    // No confirmed pattern — offer the two most likely guesses, clearly unconfirmed.
    const alts = DEFAULT_ORDER.map((id) => `${PATTERNS[id](parts.first, parts.last)}@${domain}`);
    return { name: p.name, title: p.title, email: alts[0], confidence: 'pattern-guess', pattern: DEFAULT_ORDER[0], alt_emails: alts };
  }).filter((p) => p.email);
}

// Batch over leads with limited concurrency; onProgress(done, total) streams UI.
// Returns map: company(lowercased) -> array of people.
export async function findPeopleBatch(leads, onProgress, batchSize = 3) {
  const out = {};
  const targets = leads.filter((l) => l.website);
  for (let i = 0; i < targets.length; i += batchSize) {
    await Promise.all(targets.slice(i, i + batchSize).map(async (l) => {
      try {
        const people = await findPeople(l);
        if (people.length) out[l.company.toLowerCase()] = people;
      } catch { /* skip on failure — don't block the batch */ }
    }));
    onProgress?.(Math.min(i + batchSize, targets.length), targets.length);
  }
  return out;
}
