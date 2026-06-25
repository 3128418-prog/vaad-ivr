
// api/ivr.js — Vercel Serverless Function
// פורמט תואם ימות המשיח
 
const SECRET = process.env.API_SECRET || 'vaad123';
 
async function kvGet(key) {
  try {
    var url = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return null;
    var r = await fetch(url + '/get/' + encodeURIComponent(key), {
      headers: { Authorization: 'Bearer ' + token }
    });
    if (!r.ok) return null;
    var j = await r.json();
    if (!j.result) return null;
    var val = j.result;
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
    if (typeof val === 'string') { try { val = JSON.parse(val); } catch(e) {} }
    return val;
  } catch(e) { return null; }
}
 
async function kvSet(key, value) {
  try {
    var url = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return;
    await fetch(url + '/set/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch(e) {}
}
 
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  // POST
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var s = body.secret || body.apiKey;
      if (s !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
      if (body.residents) await kvSet('vaad:residents', body.residents);
      if (body.announcement !== undefined) await kvSet('vaad:announcement', body.announcement);
      return res.status(200).json({ ok: true, count: body.residents ? body.residents.length : 0 });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
 
  // GET health
  if (req.query.health) {
    var residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: Array.isArray(residents) ? residents.length : 0 });
  }
 
  // GET IVR
  try {
    var phone = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var step  = req.query.step || 'menu';
    var digit = req.query.ApiDig || '';
    var base  = 'https://' + req.headers.host + '/api/ivr';
    var p     = phone;
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    if (!Array.isArray(residents)) residents = [];
    var resident = findResident(residents, phone);
 
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
    // טיפול בהקשה מהתפריט
    if (digit === '1') step = 'debt';
    if (digit === '2') step = 'payments';
    if (digit === '3') step = 'complaint';
    if (digit === '4') step = 'announcement';
 
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
    if (step === 'debt') {
      var txt = resident
        ? (Math.round(resident.debt||0) <= 0
            ? 'שלום ' + resident.name + '. חשבונך מאוזן. אין חוב פתוח. תודה.'
            : 'שלום ' + resident.name + '. יתרת החוב שלך היא ' + Math.round(resident.debt||0) + ' שקלים.')
        : 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      return res.send('id_list_message=t-' + txt);
    }
 
    if (step === 'payments') {
      var txt2 = resident
        ? 'שלום ' + resident.name + '. שולם סך הכל ' + (resident.paid||0) + ' שקלים מתוך ' + (resident.expected||0) + ' שקלים צפויים.'
        : 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      return res.send('id_list_message=t-' + txt2);
    }
 
    if (step === 'complaint') {
      return res.send('id_list_message=t-תלונתך התקבלה ותועברה לועד הבית. תודה.');
    }
 
    if (step === 'announcement') {
      var ann = announcement || 'אין הודעה חדשה מהועד בית.';
      return res.send('id_list_message=t-' + ann);
    }
 
    // תפריט ראשי - השמעה + ניתוב לשלוחות פנימיות
    var name = resident ? resident.name : 'דייר יקר';
    return res.send(
      'id_list_message=t-שלום ' + name + '. לשמיעת יתרת החוב לחץ 1. לשמיעת תשלומים לחץ 2. לדיווח על תקלה לחץ 3. לשמיעת הודעה מהועד לחץ 4.\n' +
      'id_list_ivr=1=' + base + '?step=debt&ApiPhone=' + p + ',2=' + base + '?step=payments&ApiPhone=' + p + ',3=' + base + '?step=complaint&ApiPhone=' + p + ',4=' + base + '?step=announcement&ApiPhone=' + p
    );
 
  } catch(e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send('id_list_message=t-שגיאה במערכת. אנא נסה שנית.');
  }
}
 
function normalizePhone(phone) {
  phone = String(phone).replace(/\D/g, '');
  if (phone.startsWith('972')) phone = '0' + phone.slice(3);
  return phone;
}
 
function findResident(residents, phone) {
  if (!phone || !residents.length) return null;
  return residents.find(function(r) {
    return normalizePhone(r.phone||'') === phone ||
           normalizePhone(r.phone2||'') === phone;
  }) || null;
}
