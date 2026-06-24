
// api/ivr.js — Vercel Serverless Function with Upstash Redis storage
 
const SECRET = process.env.API_SECRET || 'vaad123';
const KV_URL = process.env.KV_REST_API_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN;
 
// ─── Redis helpers via Upstash REST API ───────────
async function kvGet(key) {
  if (!KV_URL || !KV_TOKEN) return null;
  const r = await fetch(`${KV_URL}/get/${key}`, {
    headers: { Authorization: `Bearer ${KV_TOKEN}` }
  });
  const j = await r.json();
  return j.result ? JSON.parse(j.result) : null;
}
 
async function kvSet(key, value) {
  if (!KV_URL || !KV_TOKEN) return;
  await fetch(`${KV_URL}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KV_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(JSON.stringify(value))
  });
}
 
// ─── Main handler ─────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  // POST — receive data from website
  if (req.method === 'POST') {
    const { secret, apiKey, residents, announcement } = req.body || {};
    const s = secret || apiKey;
    if (s !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
    if (residents) await kvSet('vaad:residents', residents);
    if (announcement !== undefined) await kvSet('vaad:announcement', announcement);
    const count = residents ? residents.length : 0;
    return res.status(200).json({ ok: true, count });
  }
 
  // GET health check
  if (req.query.health) {
    const residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: residents.length });
  }
 
  // GET IVR — called by Yemot HaMashiach
  const phone = normalizePhone(req.query.phone || '');
  const step  = req.query.step || 'menu';
  const base  = `https://${req.headers.host}/api/ivr`;
 
  const residents    = await kvGet('vaad:residents') || [];
  const announcement = await kvGet('vaad:announcement') || '';
  const resident     = findResident(residents, phone);
 
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  if (step === 'debt')         return res.send(debtStep(phone, resident, base));
  if (step === 'payments')     return res.send(paymentsStep(phone, resident, base));
  if (step === 'complaint')    return res.send(complaintStep(phone, resident, base));
  if (step === 'announcement') return res.send(announcementStep(phone, announcement, base));
  return res.send(menuStep(phone, resident, base));
}
 
// ─── IVR Steps ────────────────────────────────────
function menuStep(phone, resident, base) {
  const name = resident ? resident.name : 'דייר יקר';
  return yemot(
    `שלום ${name}. לשמיעת יתרת החוב לחץ 1. לשמיעת תשלומים אחרונים לחץ 2. לדיווח על תקלה לחץ 3. לשמיעת הודעה מהועד לחץ 4.`,
    {
      '1': `${base}?phone=${phone}&step=debt`,
      '2': `${base}?phone=${phone}&step=payments`,
      '3': `${base}?phone=${phone}&step=complaint`,
      '4': `${base}?phone=${phone}&step=announcement`,
      '0': `${base}?phone=${phone}&step=menu`,
    }
  );
}
 
function debtStep(phone, resident, base) {
  let text;
  if (!resident) {
    text = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
  } else {
    const balance = Math.round(resident.debt || 0);
    text = balance <= 0
      ? `שלום ${resident.name}. חשבונך מאוזן. אין חוב פתוח. תודה.`
      : `שלום ${resident.name}. יתרת החוב שלך היא ${balance} שקלים. אנא סדר את התשלום בהקדם.`;
  }
  return yemot(text + ' לחזרה לתפריט לחץ 0.', { '0': `${base}?phone=${phone}&step=menu` });
}
 
function paymentsStep(phone, resident, base) {
  let text;
  if (!resident) {
    text = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
  } else {
    text = `שלום ${resident.name}. `;
    text += `שולם סך הכל ${resident.paid || 0} שקלים. `;
    text += `מתוך ${resident.expected || 0} שקלים צפויים.`;
  }
  return yemot(text + ' לחזרה לתפריט לחץ 0.', { '0': `${base}?phone=${phone}&step=menu` });
}
 
function complaintStep(phone, resident, base) {
  const name = resident ? resident.name : phone;
  console.log(`COMPLAINT: ${name} at ${new Date().toISOString()}`);
  return yemot('תלונתך התקבלה ותועברה לועד הבית. ועד הבית יחזור אליך בהקדם. תודה. לחזרה לתפריט לחץ 0.',
    { '0': `${base}?phone=${phone}&step=menu` });
}
 
function announcementStep(phone, announcement, base) {
  const ann = announcement || 'אין הודעה חדשה מהועד בית כרגע.';
  return yemot(`הודעה מועד הבית: ${ann}. לחזרה לתפריט לחץ 0.`,
    { '0': `${base}?phone=${phone}&step=menu` });
}
 
// ─── Helpers ──────────────────────────────────────
function yemot(text, routes) {
  const routeStr = Object.entries(routes).map(([d, u]) => `${d}=${u}`).join(',');
  return `id_list_message,1,${text}\nid_list_ivr,${routeStr}`;
}
 
function normalizePhone(phone) {
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('972')) phone = '0' + phone.slice(3);
  return phone;
}
 
function findResident(residents, phone) {
  if (!phone) return null;
  return residents.find(r =>
    normalizePhone(r.phone || '') === phone ||
    normalizePhone(r.phone2 || '') === phone
  ) || null;
}
