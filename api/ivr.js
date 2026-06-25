
// api/ivr.js — גרסה סופית
// שלוחה 8: מזהה דייר ומעביר לתפריט עם שמו
// שלוחות 8/menu/1-4: מחזירות מידע ישירות
 
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
 
  console.log('YEMOT:', req.query.step, '| phone:', req.query.ApiPhone, '| ext:', req.query.ApiExtension);
 
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  try {
    var phone    = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var step     = req.query.step || 'menu';
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    if (!Array.isArray(residents)) residents = [];
    var resident = findResident(residents, phone);
    var name = resident ? resident.name : 'דייר יקר';
 
    // ── שלב 1: שלוחה 8 — זיהוי דייר, מעבר לתפריט ──
    // מחזירים: id_list_message (שלום שם) + go_to_folder (לתפריט)
    if (step === 'menu') {
      var greeting = 'שלום ' + name + '.';
      // השמע ברכה ועבור לתפריט. שלוחת התפריט תשאל מה רוצים.
      return res.send('id_list_message=t-' + greeting + '&go_to_folder=/8/menu&');
    }
 
    // ── שלב 2: שלוחות תוכן — say_api_answer=yes בכל שלוחה ──
 
    if (step === 'debt') {
      var txt;
      if (!resident) {
        txt = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else if (Math.round(resident.debt || 0) <= 0) {
        txt = 'חשבונך מאוזן. אין חוב פתוח. תודה.';
      } else {
        txt = 'יתרת החוב שלך היא ' + Math.round(resident.debt || 0) + ' שקלים.';
      }
      return res.send(txt);
    }
 
    if (step === 'payments') {
      var txt2;
      if (!resident) {
        txt2 = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
      } else {
        txt2 = 'שולם סך הכל ' + (resident.paid || 0) + ' שקלים מתוך ' + (resident.expected || 0) + ' שקלים צפויים.';
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
 
    return res.send('id_list_message=t-שגיאה במערכת.&');
 
  } catch(e) {
    console.log('ERROR:', e.message);
    return res.send('id_list_message=t-שגיאה במערכת.&');
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
