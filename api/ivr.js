
// api/ivr.js — גרסת דיאגנוסטיקה
 
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
 
  // לוג כל הפרמטרים שימות שולח — יופיע ב-Vercel Logs
  console.log('=== YEMOT REQUEST ===');
  console.log('METHOD:', req.method);
  console.log('ALL QUERY PARAMS:', JSON.stringify(req.query));
  console.log('ALL BODY:', JSON.stringify(req.body));
  console.log('===================');
 
  // GET — IVR
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  try {
    var phone = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var digit = req.query.ApiDig || '';
 
    console.log('phone:', phone, '| digit:', digit);
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    if (!Array.isArray(residents)) residents = [];
    var resident = findResident(residents, phone);
    var name = resident ? resident.name : 'דייר יקר';
 
    console.log('resident found:', resident ? resident.name : 'NONE');
    console.log('digit value:', JSON.stringify(digit), '| length:', digit.length);
 
    // הקשה 1 — חוב
    if (digit === '1') {
      var txt = !resident
        ? 'מספר הטלפון שלך אינו מזוהה במערכת.'
        : Math.round(resident.debt || 0) <= 0
          ? 'שלום ' + name + '. חשבונך מאוזן. אין חוב פתוח.'
          : 'שלום ' + name + '. יתרת החוב שלך היא ' + Math.round(resident.debt || 0) + ' שקלים.';
      console.log('RETURNING debt:', txt);
      return res.send('id_list_message=t-' + txt + '&');
    }
 
    // הקשה 2 — תשלומים
    if (digit === '2') {
      var txt2 = !resident
        ? 'מספר הטלפון שלך אינו מזוהה במערכת.'
        : 'שלום ' + name + '. שולם ' + (resident.paid || 0) + ' מתוך ' + (resident.expected || 0) + ' שקלים.';
      console.log('RETURNING payments:', txt2);
      return res.send('id_list_message=t-' + txt2 + '&');
    }
 
    // הקשה 3 — תלונה
    if (digit === '3') {
      console.log('RETURNING complaint');
      return res.send('id_list_message=t-תלונתך התקבלה ותועברה לועד הבית. תודה.&');
    }
 
    // הקשה 4 — הודעה
    if (digit === '4') {
      var ann = announcement || 'אין הודעה חדשה מהועד הבית.';
      console.log('RETURNING announcement:', ann);
      return res.send('id_list_message=t-' + ann + '&');
    }
 
    // אין הקשה — תפריט ראשי
    var menu = 'שלום ' + name + '. לשמיעת יתרת החוב לחץ 1. לשמיעת תשלומים לחץ 2. לדיווח על תקלה לחץ 3. לשמיעת הודעה מהועד לחץ 4.';
    console.log('RETURNING menu for:', name);
    return res.send('id_list_message=t-' + menu + '&');
 
  } catch(e) {
    console.log('ERROR:', e.message, e.stack);
    return res.send('id_list_message=t-שגיאה במערכת. אנא נסה שנית.&');
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
