const PREFIXES = ['info', 'contact', 'hello', 'sales', 'support', 'admin', 'team'];

export function domainFromWebsite(website) {
  if (!website) return '';
  return website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '').toLowerCase();
}

export function guessEmails(website) {
  const domain = domainFromWebsite(website);
  if (!domain || !domain.includes('.')) return [];
  return PREFIXES.map((p) => `${p}@${domain}`);
}

export function guessFirstEmail(website) {
  const domain = domainFromWebsite(website);
  if (!domain || !domain.includes('.')) return '';
  return `info@${domain}`;
}
