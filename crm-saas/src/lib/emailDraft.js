export const ANGLES = [
  { id: 'website', label: '🌐 No website pitch' },
  { id: 'app',     label: '📱 Custom app pitch' },
  { id: 'ai',      label: '🤖 AI automation pitch' },
  { id: 'tech',    label: '⚡ Tech upgrade pitch' },
];

export function extractCity(notes) {
  return (notes || '').match(/Found in ([^.]+)\./)?.[1] || '';
}

export function extractPhone(notes) {
  return (notes || '').match(/Phone: ([^.]+)\./)?.[1] || '';
}

export function defaultAngle(lead) {
  return (!lead.website || lead.website === '') ? 'website' : 'tech';
}

export function generateDraft(lead, angle) {
  const first = (lead.contact || '').split(' ')[0] || 'there';
  const co = lead.company || 'your company';
  const noSite = !lead.website || lead.website === '';
  const domain = noSite ? '' : lead.website.replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
  const city = extractCity(lead.notes);
  const inCity = city ? ` in ${city}` : '';
  const industry = lead.industry || lead.category || 'business';
  const sig = `<p style="color:#555;font-size:14px">Best regards,<br><strong>Moiz Ahmad</strong><br>Atronm — Web &amp; AI Development<br><a href="https://atronm.com">atronm.com</a></p>`;
  const resolved = angle || defaultAngle(lead);

  if (resolved === 'website') {
    return {
      subject: `Quick question about ${co}'s online presence`,
      body: `<p>Hi ${first},</p>
<p>I was looking for ${industry.toLowerCase()} businesses${inCity} and came across ${co}. I noticed you don't currently have a website — which means potential customers searching online simply can't find you.</p>
<p>At <strong>Atronm</strong>, we build clean, fast websites for businesses like yours — delivered in 2–3 weeks, starting from <strong>$1,500</strong>.</p>
<p>What you'd get:</p>
<ul>
  <li>Professional site that ranks on Google</li>
  <li>Contact/booking form so leads come to you</li>
  <li>Mobile-friendly, fast-loading design</li>
</ul>
<p>Would you be open to a quick 10-minute call this week to see if it's a fit?</p>
${sig}`,
    };
  }
  if (resolved === 'app') {
    return {
      subject: `Custom app idea for ${co}`,
      body: `<p>Hi ${first},</p>
<p>I came across ${co}${inCity} and had an idea I wanted to share.</p>
<p>We build custom web apps at <strong>Atronm</strong> that help ${industry.toLowerCase()} businesses automate operations, serve clients online, and grow without extra headcount. Projects typically run <strong>$2,000–$6,000</strong> and go live in 4–6 weeks.</p>
<p>Examples of what we've built:</p>
<ul>
  <li>Customer portals and booking systems</li>
  <li>Internal dashboards and reporting tools</li>
  <li>E-commerce and payment integrations</li>
</ul>
<p>Is there a repetitive process at ${co} you wish was automated? Happy to brainstorm — no commitment needed.</p>
${sig}`,
    };
  }
  if (resolved === 'ai') {
    return {
      subject: `AI can save ${co} hours every week — quick idea`,
      body: `<p>Hi ${first},</p>
<p>I was researching ${industry.toLowerCase()} companies${inCity} and wanted to reach out to ${co} specifically.</p>
<p>At <strong>Atronm</strong>, we add AI to businesses like yours — think automatic lead follow-ups, smart data extraction, chatbots, or AI-assisted reporting. Most integrations cost <strong>$1,500–$4,000</strong> and pay for themselves within weeks.</p>
<p>A few things AI could handle for ${co}:</p>
<ul>
  <li>Auto-reply to common customer questions 24/7</li>
  <li>Summarise documents or emails automatically</li>
  <li>Flag priority leads or tasks without manual review</li>
</ul>
<p>Worth a 15-minute call to explore what's possible? I can show you a live demo.</p>
${sig}`,
    };
  }
  return {
    subject: `Atronm × ${co} — a quick idea`,
    body: `<p>Hi ${first},</p>
<p>I visited <a href="${lead.website && lead.website.startsWith('http') ? lead.website : 'https://' + (domain || lead.website)}">${domain || lead.website}</a> and noticed ${co} is already established${inCity}.</p>
<p>At <strong>Atronm</strong>, we specialise in web apps, AI integrations, and cloud infrastructure. Our typical engagement is <strong>$2,000–$8,000</strong> and delivers in 4–6 weeks.</p>
<p>What we could do for ${co}:</p>
<ul>
  <li>Speed up or modernise your current site/app</li>
  <li>Build internal tools that reduce manual work</li>
  <li>Add AI features your competitors don't have yet</li>
</ul>
<p>Happy to jump on a 15-minute call — no pitch, just exploring if there's a fit.</p>
${sig}`,
  };
}
