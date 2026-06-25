
// api/ivr.js — ועד בית IVR — גרסה מלאה
// שלוחות:
//   8       → תפריט ראשי (זיהוי + מעבר ל-8/9)
//   8/9     → type=menu עם קובץ 000.tts
//   8/9/1   → חוב (step=debt)
//   8/9/2   → תשלומים אחרונים (step=payments)
//   8/9/3   → פירוט תשלומים לפי תאריך (step=paydetail)
//   8/9/4   → הוצאות בניין (step=expenses)
//   8/9/5   → הודעה מהועד (step=announcement)
//   8/7     → שלוחת ועד בית (מוגנת סיסמה)
//     8/7/1 → רישום תשלום מזומן (step=addpay)
//     8/7/2 → רישום הוצאה (step=addexpense)
 
const SECRET      = process.env.API_SECRET || 'vaad123';
const VAAD_PIN    = process.env.VAAD_PIN   || '1234'; // סיסמת ועד בית
 
// ─── Redis helpers ───────────────────────────────────────────────────────────
async function kvGet(key) {
  try {
    var url   = process.env.KV_REST_API_URL;
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
    var url   = process.env.KV_REST_API_URL;
    var token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) return;
    await fetch(url + '/set/' + encodeURIComponent(key), {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify(JSON.stringify(value))
    });
  } catch(e) {}
}
 
// ─── Helpers ─────────────────────────────────────────────────────────────────
function normalizePhone(phone) {
  phone = String(phone || '').replace(/\D/g, '');
  if (phone.startsWith('972')) phone = '0' + phone.slice(3);
  return phone;
}
 
function findResident(residents, phone) {
  if (!phone || !residents.length) return null;
  return residents.find(function(r) {
    return normalizePhone(r.phone  || '') === phone ||
           normalizePhone(r.phone2 || '') === phone;
  }) || null;
}
 
function hebrewDate(dateStr) {
  // ממיר "02.06.2026" או "2026-06-02" לטקסט עברי לקריאה "ה-2 ביוני 2026"
  if (!dateStr) return '';
  var d;
  if (dateStr.match(/^\d{2}\.\d{2}\.\d{4}$/)) {
    var p = dateStr.split('.');
    d = new Date(p[2], p[1]-1, p[0]);
  } else {
    d = new Date(dateStr);
  }
  if (isNaN(d)) return dateStr;
  var months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return 'ה-' + d.getDate() + ' ב' + months[d.getMonth()] + ' ' + d.getFullYear();
}
 
function todayStr() {
  var d = new Date();
  var dd = String(d.getDate()).padStart(2,'0');
  var mm = String(d.getMonth()+1).padStart(2,'0');
  var yy = d.getFullYear();
  return dd + '.' + mm + '.' + yy;
}
 
// ─── Main handler ─────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
 
  // ── POST: עדכון מהאתר ────────────────────────────────────────────────────
  if (req.method === 'POST') {
    try {
      var body = req.body || {};
      var s = body.secret || body.apiKey;
      if (s !== SECRET) return res.status(401).json({ error: 'Unauthorized' });
      if (body.residents)    await kvSet('vaad:residents', body.residents);
      if (body.expenses)     await kvSet('vaad:expenses',  body.expenses);
      if (body.announcement !== undefined) await kvSet('vaad:announcement', body.announcement);
 
      // תשלומים שנרשמו דרך IVR — נאחד עם מה שהאתר שלח
      if (body.ivr_payment) {
        var ivrPays = await kvGet('vaad:ivr_payments') || [];
        ivrPays.push(body.ivr_payment);
        await kvSet('vaad:ivr_payments', ivrPays);
      }
      if (body.ivr_expense) {
        var ivrExps = await kvGet('vaad:ivr_expenses') || [];
        ivrExps.push(body.ivr_expense);
        await kvSet('vaad:ivr_expenses', ivrExps);
      }
 
      return res.status(200).json({
        ok: true,
        count: body.residents ? body.residents.length : 0
      });
    } catch(e) {
      return res.status(500).json({ error: e.message });
    }
  }
 
  // ── GET: health ───────────────────────────────────────────────────────────
  if (req.query.health) {
    var residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: Array.isArray(residents) ? residents.length : 0 });
  }
 
  // ── GET: IVR ──────────────────────────────────────────────────────────────
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  try {
    var phone = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var step  = req.query.step || 'menu';
 
    console.log('IVR:', step, '| phone:', phone);
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    var expData      = await kvGet('vaad:expenses') || { total: 0, recent: [] };
    if (!Array.isArray(residents)) residents = [];
 
    var resident = findResident(residents, phone);
    var name = resident ? resident.name : 'דייר יקר';
 
    // ════════════════════════════════════════════════
    // שלוחה 8 — תפריט ראשי
    // ════════════════════════════════════════════════
    if (step === 'menu') {
      var greeting = 'שלום ' + name + '.';
      return res.send('id_list_message=t-' + greeting + '&go_to_folder=/8/9&');
    }
 
    // ════════════════════════════════════════════════
    // שלוחות תוכן דיירים — say_api_answer=yes
    // ════════════════════════════════════════════════
 
    // חוב נוכחי
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
 
    // סיכום תשלומים
    if (step === 'payments') {
      var txt2;
      if (!resident) {
        txt2 = 'מספר הטלפון שלך אינו מזוהה במערכת.';
      } else {
        txt2 = 'שלום ' + name + '. שולם סך הכל ' + (resident.paid || 0) +
               ' שקלים מתוך ' + (resident.expected || 0) + ' שקלים צפויים.';
      }
      return res.send(txt2);
    }
 
    // פירוט תשלומים לפי תאריך
    if (step === 'paydetail') {
      if (!resident) {
        return res.send('מספר הטלפון שלך אינו מזוהה במערכת.');
      }
      var pays = resident.payments || [];
      if (!pays.length) {
        return res.send('שלום ' + name + '. לא נמצאו תשלומים רשומים.');
      }
      var lines = pays.map(function(p) {
        return hebrewDate(p.date) + ' שולמו ' + p.amount + ' שקלים' +
               (p.note ? ', ' + p.note : '') + '.';
      });
      var txt3 = 'שלום ' + name + '. להלן ' + pays.length + ' התשלומים האחרונים שלך. ' +
                 lines.join(' ') + ' סוף רשימה.';
      return res.send(txt3);
    }
 
    // הוצאות בניין
    if (step === 'expenses') {
      var total   = expData.total || 0;
      var recent  = expData.recent || [];
 
      // גם הוצאות שנרשמו דרך IVR
      var ivrExps = await kvGet('vaad:ivr_expenses') || [];
      var ivrTotal = ivrExps.reduce(function(s,e){ return s+(e.amount||0); }, 0);
      total += ivrTotal;
 
      var allRecent = ivrExps.concat(recent).sort(function(a,b){
        return new Date(b.date||0) - new Date(a.date||0);
      }).slice(0,5);
 
      var expLines = allRecent.map(function(e) {
        return hebrewDate(e.date) + ': ' + (e.desc||'הוצאה') + ' — ' + (e.amount||0) + ' שקלים.';
      }).join(' ');
 
      var expTxt = 'הוצאות הבניין הכוללות עומדות על ' + total + ' שקלים. ';
      if (allRecent.length) {
        expTxt += 'ההוצאות האחרונות: ' + expLines;
      }
      return res.send(expTxt);
    }
 
    // הודעה מהועד
    if (step === 'announcement') {
      var ann = announcement || 'אין הודעה חדשה מהועד הבית.';
      return res.send(ann);
    }
 
    // ════════════════════════════════════════════════
    // שלוחת ועד בית — רישום תשלום מזומן
    // שלוחה 8/7/1: say_api_answer=yes, api_add_0=step=addpay
    // ימות שולח: ApiDig (הסכום שהוקש) + api_add_1=resphone=PHONE
    // ════════════════════════════════════════════════
    if (step === 'addpay') {
      var digit    = req.query.ApiDig || '';
      var resPhone = req.query.resphone || '';
      var amount   = parseInt(digit) || 0;
 
      if (!amount) {
        return res.send('לא הוקש סכום תקין. אנא נסה שנית.');
      }
 
      var target = resPhone ? findResident(residents, normalizePhone(resPhone)) : null;
      var rName  = target ? target.name : 'דייר לא ידוע';
 
      // שמור ב-Redis
      var ivrPay = {
        phone:  resPhone,
        name:   rName,
        amount: amount,
        date:   todayStr(),
        note:   'מזומן דרך IVR',
        id:     'ivr_' + Date.now()
      };
      var ivrPays2 = await kvGet('vaad:ivr_payments') || [];
      ivrPays2.push(ivrPay);
      await kvSet('vaad:ivr_payments', ivrPays2);
 
      return res.send('תשלום של ' + amount + ' שקלים לדייר ' + rName +
                      ' נרשם בהצלחה בתאריך ' + todayStr() + '. תודה.');
    }
 
    // ════════════════════════════════════════════════
    // שלוחת ועד בית — רישום הוצאה
    // שלוחה 8/7/2: say_api_answer=yes, api_add_0=step=addexpense
    // ימות שולח: ApiDig (הסכום) — תיאור ממוקלט בנפרד
    // ════════════════════════════════════════════════
    if (step === 'addexpense') {
      var digit2   = req.query.ApiDig || '';
      var desc2    = req.query.desc   || 'הוצאה כללית';
      var amount2  = parseInt(digit2) || 0;
 
      if (!amount2) {
        return res.send('לא הוקש סכום תקין. אנא נסה שנית.');
      }
 
      var ivrExp = {
        amount: amount2,
        desc:   desc2,
        date:   todayStr(),
        cat:    'IVR',
        id:     'ivr_' + Date.now()
      };
      var ivrExps2 = await kvGet('vaad:ivr_expenses') || [];
      ivrExps2.push(ivrExp);
      await kvSet('vaad:ivr_expenses', ivrExps2);
 
      return res.send('הוצאה של ' + amount2 + ' שקלים נרשמה בהצלחה בתאריך ' +
                      todayStr() + '. תודה.');
    }
 
    // ── endpoint לקריאת תשלומי IVR מהאתר ─────────────────────────────────
    if (step === 'get_ivr_payments') {
      var s2 = req.query.secret || '';
      if (s2 !== SECRET) return res.status(401).send('Unauthorized');
      var ivrP = await kvGet('vaad:ivr_payments') || [];
      var ivrE = await kvGet('vaad:ivr_expenses') || [];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify({ payments: ivrP, expenses: ivrE }));
    }
 
    return res.send('id_list_message=t-שגיאה במערכת. אנא נסה שנית.&');
 
  } catch(e) {
    console.log('ERROR:', e.message);
    return res.send('id_list_message=t-שגיאה במערכת.&');
  }
}
