
// api/ivr.js — Vercel Serverless Function with Upstash Redis
 
const SECRET = process.env.API_SECRET || 'vaad123';
 
// ─── Redis helpers via Upstash REST API ───────────
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
    return JSON.parse(j.result);
  } catch(e) { return null; }
}
 
async function kvSet(key, value) {
  try {
    var url = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return;
    var body = JSON.stringify(JSON.stringify(value));
    await fetch(url + '/set/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: body
    });
  } catch(e) {}
}
 
// ─── Main handler ─────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
 
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
 
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
 
  // GET health check
  if (req.query.health) {
    try {
      var residents = await kvGet('vaad:residents') || [];
      return res.status(200).json({ ok: true, residents: residents.length });
    } catch(e) {
      return res.status(200).json({ ok: true, residents: 0 });
    }
  }
 
  // GET IVR — called by Yemot HaMashiach
  try {
    var phone = normalizePhone(req.query.phone || '');
    var step  = req.query.step || 'menu';
    var host  = req.headers.host || '';
    var base  = 'https://' + host + '/api/ivr';
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    var resident     = findResident(residents, phone);
 
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
    var text = '';
    if (step === 'debt') {
      text = debtText(resident);
    } else if (step === 'payments') {
      text = paymentsText(resident);
    } else if (step === 'complaint') {
      text = 'תלונתך התקבלה ותועברה לועד הבית. ועד הבית יחזור אליך בהקדם. תודה.';
    } else if (step === 'announcement') {
      text = 'הודעה מועד הבית: ' + (announcement || 'אין הודעה חדשה כרגע.');
    } else {
      // menu
      var name = resident ? resident.name : 'דייר יקר';
      text = 'שלום ' + name + '. לשמיעת יתרת החוב לחץ 1. לשמיעת תשלומים לחץ 2. לדיווח על תקלה לחץ 3. לשמיעת הודעה מהועד לחץ 4.';
    }
 
    var routes = {
      '1': base + '?phone=' + phone + '&step=debt',
      '2': base + '?phone=' + phone + '&step=payments',
      '3': base + '?phone=' + phone + '&step=complaint',
      '4': base + '?phone=' + phone + '&step=announcement',
      '0': base + '?phone=' + phone + '&step=menu'
    };
 
    if (step !== 'menu') {
      routes = { '0': base + '?phone=' + phone + '&step=menu' };
      text += ' לחזרה לתפריט לחץ 0.';
    }
 
    return res.send(buildYemot(text, routes));
 
  } catch(e) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.send(buildYemot('שגיאה במערכת. אנא נסה שנית מאוחר יותר.', {}));
  }
}
 
// ─── Helpers ──────────────────────────────────────
function debtText(resident) {
  if (!resident) return 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
  var balance = Math.round(resident.debt || 0);
  if (balance <= 0) return 'שלום ' + resident.name + '. חשבונך מאוזן. אין חוב פתוח. תודה.';
  return 'שלום ' + resident.name + '. יתרת החוב שלך היא ' + balance + ' שקלים. אנא סדר את התשלום בהקדם.';
}
 
function paymentsText(resident) {
  if (!resident) return 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.';
  return 'שלום ' + resident.name + '. שולם סך הכל ' + (resident.paid || 0) + ' שקלים. מתוך ' + (resident.expected || 0) + ' שקלים צפויים.';
}
 
function buildYemot(text, routes) {
  var lines = 'id_list_message,1,' + text;
  var routeArr = Object.keys(routes).map(function(d) { return d + '=' + routes[d]; });
  if (routeArr.length > 0) {
    lines += '\nid_list_ivr,' + routeArr.join(',');
  }
  return lines;
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
