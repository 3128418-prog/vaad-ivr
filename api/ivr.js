// api/ivr.js — Vercel Serverless Function
// פורמט תואם ימות המשיח עם say_api_answer=yes
 
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
 
  // POST — receive data from website
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var s = body.secret || body.apiKey;
      if (s !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
      if (body.residents) await kvSet('vaad:residents', body.residents);
      if (body.announcement !== undefined) await kvSet('vaad:announcement', body.announcement);
      var count = body.residents ? body.residents.length : 0;
      return res.status(200).json({ ok: true, count: count });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
 
  // GET health
  if (req.query.health) {
    var residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: Array.isArray(residents) ? residents.length : 0 });
  }
 
  // GET IVR — ימות המשיח
  try {
    var phone = normalizePhone(req.query.phone || '');
    var step  = req.query.step || 'menu';
    var digit = req.query.ApiDig || req.query.digit || '';
    var base  = 'https://' + req.headers.host + '/api/ivr';
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    if (!Array.isArray(residents)) residents = [];
    var resident = findResident(residents, phone);
 
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
    // ── תפריט ראשי
    if (step === 'menu' || !step) {
      var name = resident ? resident.name : 'דייר יקר';
      return res.send(
        'read=menu,,1,שלום ' + name + '. ' +
        'לשמיעת יתרת החוב לחץ 1. ' +
        'לשמיעת תשלומים לחץ 2. ' +
        'לדיווח על תקלה לחץ 3. ' +
        'לשמיעת הודעה מהועד לחץ 4.,DIGITS,1,10,,'
      );
    }
 
    // ── טיפול בהקשה מהתפריט
    if (step === 'menu_answer') {
      if (digit === '1') return res.send('go_to_folder=' + base.replace('https://', '') + '?step=debt&phone=' + phone);
      if (digit === '2') return res.send('go_to_folder=' + base.replace('https://', '') + '?step=payments&phone=' + phone);
      if (digit === '3') return res.send('id_list_message=t-תלונתך התקבלה ותועברה לועד הבית. תודה.');
      if (digit === '4') {
        var ann = announcement || 'אין הודעה חדשה מהועד בית.';
        return res.send('id_list_message=t-' + ann);
      }
      return res.send('go_to_folder=/');
    }
 
    // ── חוב
    if (step === 'debt') {
      var txt;
      if (!resident) {
        txt = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else {
        var debt = Math.round(resident.debt || 0);
        txt = debt <= 0
          ? 'שלום ' + resident.name + '. חשבונך מאוזן. אין חוב פתוח. תודה.'
          : 'שלום ' + resident.name + '. יתרת החוב שלך היא ' + debt + ' שקלים.';
      }
      return res.send('id_list_message=t-' + txt);
    }
 
    // ── תשלומים
    if (step === 'payments') {
      var txt2;
      if (!resident) {
        txt2 = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else {
        txt2 = 'שלום ' + resident.name + '. שולם סך הכל ' + (resident.paid || 0) + ' שקלים מתוך ' + (resident.expected || 0) + ' שקלים צפויים.';
      }
      return res.send('id_list_message=t-' + txt2);
    }
 
    return res.send('go_to_folder=/');
 
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
    return normalizePhone(r.phone || '') === phone ||
           normalizePhone(r.phone2 || '') === phone;
  }) || null;
}
