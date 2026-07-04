// ICP fit score — deliberately separate from the Genuine Check score.
// Genuine Check answers "is this a real, reachable business?" (DNS/MX/
// domain age). This answers a different question: "is this the kind of
// business we should be pitching?" A lead can be 100% genuine and still
// be a terrible fit (wrong industry, no decision-maker found, no budget
// signal) — collapsing both into one number was the old CRM's mistake.
//
// Structured and explainable on purpose: every point traces to a concrete,
// checkable fact about the lead, not an arbitrary slider a human dragged.

const TARGET_CATEGORIES = [
  'saas', 'agency', 'ai', 'ai/llm', 'fintech', 'e-commerce', 'ecommerce',
  'cloud', 'devops', 'mobile', 'edtech', 'tech', 'startup', 'embedded',
];

export function computeIcpScore(lead) {
  let score = 0;
  const reasons = [];

  // Website — a business without one is often too small/early for most
  // B2B service offers, but the "no website" pitch angle exists specifically
  // to target this segment, so it's a smaller penalty than it might seem.
  if (lead.website) { score += 15; reasons.push('Has a website'); }

  // Named decision-maker — this is the single strongest fit signal, since
  // it means an actual person to sell to was found (not just a company).
  if (lead.contact) { score += 25; reasons.push('Named contact identified'); }

  // Industry/category match against what this business actually sells into.
  const cat = (lead.category || lead.industry || '').toLowerCase();
  if (TARGET_CATEGORIES.some((t) => cat.includes(t))) {
    score += 25; reasons.push(`Industry match (${lead.category || lead.industry})`);
  } else if (cat) {
    score += 8; reasons.push('Industry outside primary targets');
  }

  // Deal-size signal — presence of an opportunity_size estimate means
  // someone (human or AI) already sized this as a real prospective deal.
  if (lead.opportunity_size) { score += 15; reasons.push('Deal size estimated'); }

  // Phone number — an extra reachability channel beyond email.
  if (/Phone:\s*\S/.test(lead.notes || '')) { score += 10; reasons.push('Phone number on file'); }

  // Country present at all — enables timezone-aware sequencing later.
  if (lead.country) { score += 10; reasons.push('Location known'); }

  return { score: Math.min(100, score), reasons };
}

export function icpLabel(score) {
  return score >= 70 ? 'Strong fit' : score >= 45 ? 'Possible fit' : 'Weak fit';
}
export function icpColor(score) {
  return score >= 70 ? '#16a34a' : score >= 45 ? '#d97706' : '#94a3b8';
}
