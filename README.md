
// api/ivr.js — Vercel Serverless Function
// ימות המשיח IVR for vaad bayit
 
// In-memory store (shared across warm instances)
// Data is pushed from the website via POST /api/ivr
let store = {
  residents: [],
  announcement: '',
  lastUpdated: null,
};
 
const SECRET = process.env.API_SECRET || 'vaad123';
 
export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  // ── POST /api/ivr ── receive data from website
  if (req.method === 'POST') {
    const { secret, residents, announcement } = req.body || {};
    if (secret !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
    if (residents) store.residents = residents;
    if (announcement !== undefined) store.announcement = announcement;
    store.lastUpdated = new Date().toISOString();
    return res.status(200).json({ ok: true, count: store.residents.length });
  }
 
  // ── GET /api/ivr?health=1 ── connection test
  if (req.query.health) {
    return res.status(200).json({
      ok: true,
      residents: store.residents.length,
      lastUpdated: store.lastUpdated,
    });
  }
 
  // ── GET /api/ivr?phone=XXX&step=YYY ── IVR logic
  const phone = normalizePhone(req.query.phone || '');
  const step = req.query.step || 'menu';
  const base = `https://${req.headers.host}/api/ivr`;
 
  const resident = findResident(phone);
 
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  if (step === 'debt')         return res.send(debtStep(phone, resident, base));
  if (step === 'payments')     return res.send(paymentsStep(phone, resident, base));
  if (step === 'complaint')    return res.send(complaintStep(phone, resident, base));
  if (step === 'announcement') return res.send(announcementStep(phone, base));
 
  return res.send(menuStep(phone, resident, base));
}
 
// ─── Steps ───────────────────────────────────────────
 
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
    const balance = Math.round(resident.balance || 0);
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
    const payments = (resident.payments || []).slice(-3).reverse();
    if (!payments.length) {
      text = `שלום ${resident.name}. לא נמצאו תשלומים במערכת.`;
    } else {
      text = `שלום ${resident.name}. התשלומים האחרונים שלך: `;
      payments.forEach(p => {
        text += `${formatDate(p.date)} — ${Math.round(p.amount)} שקלים. `;
      });
    }
  }
  return yemot(text + ' לחזרה לתפריט לחץ 0.', { '0': `${base}?phone=${phone}&step=menu` });
}
 
function complaintStep(phone, resident, base) {
  const name = resident ? resident.name : phone;
  console.log(`COMPLAINT: ${name} at ${new Date().toISOString()}`);
  const text = 'תלונתך התקבלה ותועברה לועד הבית. ועד הבית יחזור אליך בהקדם. תודה. לחזרה לתפריט לחץ 0.';
  return yemot(text, { '0': `${base}?phone=${phone}&step=menu` });
}
 
function announcementStep(phone, base) {
  const ann = store.announcement || 'אין הודעה חדשה מהועד בית כרגע.';
  const text = `הודעה מועד הבית: ${ann}. לחזרה לתפריט לחץ 0.`;
  return yemot(text, { '0': `${base}?phone=${phone}&step=menu` });
}
 
// ─── Helpers ─────────────────────────────────────────
 
function yemot(text, routes) {
  const routeStr = Object.entries(routes)
    .map(([digit, url]) => `${digit}=${url}`)
    .join(',');
  return `id_list_message,1,${text}\nid_list_ivr,${routeStr}`;
}
 
function normalizePhone(phone) {
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('972')) phone = '0' + phone.slice(3);
  return phone;
}
 
function findResident(phone) {
  if (!phone) return null;
  return store.residents.find(r => {
    return normalizePhone(r.phone1 || '') === phone ||
           normalizePhone(r.phone2 || '') === phone;
  }) || null;
}
 
function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return `${d.getDate()} ב${months[d.getMonth()]} ${d.getFullYear()}`;
