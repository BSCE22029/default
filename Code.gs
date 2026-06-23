// ============================================================
//  IT Leads CRM — Google Apps Script Backend (Code.gs)
//  Paste this into: Extensions → Apps Script → Code.gs
//  Then: Deploy → New Deployment → Web App
//        Execute as: Me | Who has access: Anyone
//  Copy the Web App URL into the CRM → Deploy → Connect Sheets
// ============================================================

const LEADS_SHEET     = 'Leads';
const ACTIVITY_SHEET  = 'Activities';
const META_SHEET      = 'Meta';

// ── Entry points ─────────────────────────────────────────────
function doGet(e)  { return route(e.parameter.action, null); }
function doPost(e) {
  const body = JSON.parse(e.postData.contents);
  return route(body.action, body);
}

function route(action, body) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  try {
    let result;
    switch (action) {
      case 'getData':       result = getData(ss);                        break;
      case 'saveLeads':     saveLeads(ss, body.leads);  result = ok();   break;
      case 'saveLead':      upsertLead(ss, body.lead);  result = ok();   break;
      case 'deleteLead':    deleteLead(ss, body.id);    result = ok();   break;
      case 'saveActivities':saveActivities(ss, body.activities); result = ok(); break;
      case 'ping':          result = { pong: true, ts: new Date().toISOString() }; break;
      default:              result = { error: 'Unknown action: ' + action };
    }
    return json(result);
  } catch(err) {
    return json({ error: err.toString(), stack: err.stack });
  }
}

// ── Read all data ─────────────────────────────────────────────
function getData(ss) {
  const leads      = sheetToObjects(getSheet(ss, LEADS_SHEET)).map(parseLead);
  const activities = sheetToObjects(getSheet(ss, ACTIVITY_SHEET));
  return { leads, activities, ts: new Date().toISOString() };
}

// ── Save / replace all leads ──────────────────────────────────
function saveLeads(ss, leads) {
  const sheet = getSheet(ss, LEADS_SHEET);
  sheet.clearContents();
  if (!leads || leads.length === 0) return;
  const headers = leadHeaders();
  sheet.appendRow(headers);
  leads.forEach(l => sheet.appendRow(headers.map(h => serializeField(l[h]))));
}

// ── Upsert one lead ───────────────────────────────────────────
function upsertLead(ss, lead) {
  const sheet = getSheet(ss, LEADS_SHEET);
  const data  = sheet.getDataRange().getValues();
  if (data.length === 0) {
    // Empty sheet — write headers + row
    sheet.appendRow(leadHeaders());
    sheet.appendRow(leadHeaders().map(h => serializeField(lead[h])));
    return;
  }
  const headers = data[0];
  const idCol   = headers.indexOf('id');
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][idCol]) === String(lead.id)) {
      sheet.getRange(r + 1, 1, 1, headers.length)
           .setValues([headers.map(h => serializeField(lead[h]))]);
      return;
    }
  }
  // Not found → append
  sheet.appendRow(headers.map(h => serializeField(lead[h])));
}

// ── Delete one lead ───────────────────────────────────────────
function deleteLead(ss, id) {
  const sheet = getSheet(ss, LEADS_SHEET);
  const data  = sheet.getDataRange().getValues();
  if (data.length === 0) return;
  const idCol = data[0].indexOf('id');
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][idCol]) === String(id)) {
      sheet.deleteRow(r + 1);
      return;
    }
  }
}

// ── Save activities ───────────────────────────────────────────
function saveActivities(ss, activities) {
  const sheet = getSheet(ss, ACTIVITY_SHEET);
  sheet.clearContents();
  if (!activities || activities.length === 0) return;
  const headers = ['type','text','color','time'];
  sheet.appendRow(headers);
  activities.forEach(a => sheet.appendRow(headers.map(h => a[h] || '')));
}

// ── Helpers ───────────────────────────────────────────────────
function getSheet(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function sheetToObjects(sheet) {
  const data = sheet.getDataRange().getValues();
  if (data.length <= 1) return [];
  const headers = data[0];
  return data.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => { if (h !== '') obj[h] = row[i]; });
    return obj;
  });
}

function parseLead(l) {
  ['emailSent','emailOpened','emailReplied','emailBounced'].forEach(f => {
    l[f] = l[f] === true || l[f] === 'true' || l[f] === 'TRUE';
  });
  l.leadScore = parseInt(l.leadScore)  || 0;
  l.wave      = parseInt(l.wave)       || 1;
  l.id        = parseInt(l.id)         || 0;
  try { l.activities = typeof l.activities === 'string' ? JSON.parse(l.activities) : (l.activities || []); }
  catch(e) { l.activities = []; }
  return l;
}

function serializeField(v) {
  if (v === null || v === undefined) return '';
  if (Array.isArray(v) || (typeof v === 'object')) return JSON.stringify(v);
  return v;
}

function leadHeaders() {
  return ['id','company','website','industry','country','category','contact','email',
          'linkedin','leadScore','opportunitySize','status','wave','notes',
          'emailSent','emailOpened','emailReplied','emailBounced',
          'lastContact','createdAt','activities'];
}

function ok()   { return { success: true }; }
function json(d){ return ContentService.createTextOutput(JSON.stringify(d)).setMimeType(ContentService.MimeType.JSON); }
