
// api/ivr.js — Vercel Serverless Function
// פורמט תואם ימות המשיח — גרסה מתוקנת
 
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
 
  // POST — עדכון דיירים מהאתר
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
 
  // GET health check
  if (req.query.health) {
    var residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: Array.isArray(residents) ? residents.length : 0 });
  }
 
  // GET — IVR
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  try {
    var phone = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var step  = req.query.step || 'menu';
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    if (!Array.isArray(residents)) residents = [];
    var resident = findResident(residents, phone);
    var name = resident ? resident.name : 'דייר יקר';
 
    // ─── שלב 1: תפריט ראשי ───
    // שלוחה 8: say_api_answer=yes → ימות ישמע את הטקסט ואז יפנה לפי הקשה (api_1..api_4)
    if (step === 'menu') {
      var greeting = 'שלום ' + name + '. ';
      greeting += 'לשמיעת יתרת החוב לחץ 1. ';
      greeting += 'לשמיעת תשלומים לחץ 2. ';
      greeting += 'לדיווח על תקלה לחץ 3. ';
      greeting += 'לשמיעת הודעה מהועד לחץ 4.';
      // say_api_answer=yes מצפה לטקסט נקי בלי id_list_message
      return res.send(greeting);
    }
 
    // ─── שלב 2: שלוחות פנימיות (8/1, 8/2, 8/3, 8/4) ───
    // שלוחות אלו: type=api, api_link=...?step=debt וכו', say_api_answer=yes
 
    if (step === 'debt') {
      var txt;
      if (!resident) {
        txt = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else if (Math.round(resident.debt || 0) <= 0) {
        txt = 'שלום ' + name + '. חשבונך מאוזן. אין חוב פתוח. תודה.';
      } else {
        txt = 'שלום ' + name + '. יתרת החוב שלך היא ' + Math.round(resident.debt || 0) + ' שקלים.';
      }
      return res.send(txt);
    }
 
    if (step === 'payments') {
      var txt2;
      if (!resident) {
        txt2 = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else {
        txt2 = 'שלום ' + name + '. שולם סך הכל ' + (resident.paid || 0) + ' שקלים מתוך ' + (resident.expected || 0) + ' שקלים צפויים.';
      }
      return res.send(txt2);
    }
 
    if (step === 'complaint') {
      return res.send('תלונתך התקבלה ותועברה לועד הבית. תודה.');
    }
 
    if (step === 'announcement') {
      var ann = announcement || 'אין הודעה חדשה מהועד הבית.';
      return res.send(ann);
    }
 
    // fallback
    return res.send('שגיאה במערכת. אנא נסה שנית.');
 
  } catch(e) {
    return res.send('שגיאה במערכת. אנא נסה שנית.');
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
