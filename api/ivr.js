
// api/ivr.js — ועד בית IVR — גרסה מלאה
// שלוחות דיירים:
//   8       → תפריט ראשי (זיהוי + מעבר ל-8/9)
//   8/9     → type=menu עם קובץ 000.tts
//   8/9/1   → חוב (step=debt)
//   8/9/2   → תשלומים (step=payments)
//   8/9/3   → פירוט תשלומים (step=paydetail)
//   8/9/4   → הוצאות (step=expenses)
//   8/9/5   → הודעה (step=announcement)
//
// שלוחות ועד בית (8/7):
//   8/7/1   → רישום תשלום מזומן (step=addpay)
//   8/7/2   → רישום הוצאה (step=addexpense)
//   8/7/3   → 10 הוצאות אחרונות (step=vaad_expenses)
//   8/7/4   → 10 תשלומי מזומן אחרונים (step=vaad_cashpays)
//   8/7/5   → צינתוק לדייר לפי דירה (step=zinguk)
 
const SECRET   = process.env.API_SECRET || 'vaad123';
const VAAD_PIN = process.env.VAAD_PIN   || '1234';
 
// ─── Redis helpers ────────────────────────────────────────────────────────────
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
 
// ─── Helpers ──────────────────────────────────────────────────────────────────
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
 
function findResidentByApt(residents, apt) {
  if (!apt) return null;
  var q = String(apt).replace(/\D/g, '');
  return residents.find(function(r) {
    return String(r.apt || '').replace(/\D/g, '') === q;
  }) || null;
}
 
function hebrewDate(dateStr) {
  if (!dateStr) return '';
  var d;
  // support DD.MM.YYYY
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
  return String(d.getDate()).padStart(2,'0') + '.' +
         String(d.getMonth()+1).padStart(2,'0') + '.' + d.getFullYear();
}
 
function sortByDate(arr) {
  return arr.slice().sort(function(a, b) {
    return new Date(b.date||0) - new Date(a.date||0);
  });
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
      if ((body.secret || body.apiKey) !== SECRET)
        return res.status(401).json({ error: 'Unauthorized' });
      if (body.residents)    await kvSet('vaad:residents', body.residents);
      if (body.vaad_phones)   await kvSet('vaad:vaad_phones', body.vaad_phones);
      if (body.expenses)     await kvSet('vaad:expenses',  body.expenses);
      if (body.announcement !== undefined)
        await kvSet('vaad:announcement', body.announcement);
      return res.status(200).json({ ok: true, count: (body.residents||[]).length });
    } catch(e) { return res.status(500).json({ error: e.message }); }
  }
 
  // ── GET: health ───────────────────────────────────────────────────────────
  if (req.query.health) {
    var residents = await kvGet('vaad:residents') || [];
    return res.status(200).json({ ok: true, residents: residents.length });
  }
 
  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
 
  try {
    var phone = normalizePhone(req.query.ApiPhone || req.query.phone || '');
    var step  = req.query.step || 'menu';
    console.log('IVR step:', step, '| phone:', phone);
 
    var residents    = await kvGet('vaad:residents') || [];
    var announcement = await kvGet('vaad:announcement') || '';
    var expData      = await kvGet('vaad:expenses') || { total: 0, recent: [] };
    if (!Array.isArray(residents)) residents = [];
 
    var resident = findResident(residents, phone);
    var name = resident ? resident.name : 'דייר יקר';
 
    // ════════════════════════════════════════════════
    // שלוחות דיירים
    // ════════════════════════════════════════════════
 
    if (step === 'menu') {
      // בדוק אם מספר ועד בית — העבר ל-8/7
      var vaadPhones = await kvGet('vaad:vaad_phones') || [];
      if (vaadPhones.includes(phone)) {
        return res.send('go_to_folder=/8/7&');
      }
      // דייר רגיל — ברך ושלח לתפריט (גם אם לא מזוהה)
      var greeting = resident ? 'שלום ' + name + '.' : 'שלום.';
      return res.send('id_list_message=t-' + greeting + '&go_to_folder=/8/9&');
    }
 
    if (step === 'debt') {
      if (!resident) return res.send('מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית.');
      var debt = Math.round(resident.debt || 0);
      if (debt <= 0) return res.send('שלום ' + name + '. חשבונך מאוזן. אין חוב פתוח. תודה.');
      return res.send('שלום ' + name + '. יתרת החוב שלך היא ' + debt + ' שקלים.');
    }
 
    if (step === 'payments') {
      if (!resident) return res.send('מספר הטלפון שלך אינו מזוהה במערכת.');
      return res.send('שלום ' + name + '. שולם סך הכל ' + (resident.paid||0) +
        ' שקלים מתוך ' + (resident.expected||0) + ' שקלים צפויים.');
    }
 
    if (step === 'paydetail') {
      if (!resident) return res.send('מספר הטלפון שלך אינו מזוהה במערכת.');
      var pays = resident.payments || [];
      if (!pays.length) return res.send('שלום ' + name + '. לא נמצאו תשלומים רשומים.');
      var lines = pays.map(function(p) {
        return hebrewDate(p.date) + ' שולמו ' + p.amount + ' שקלים' +
               (p.note ? ', ' + p.note : '') + '.';
      });
      return res.send('שלום ' + name + '. להלן ' + pays.length + ' תשלומים אחרונים. ' +
                      lines.join(' ') + ' סוף רשימה.');
    }
 
    if (step === 'expenses') {
      var total   = expData.total || 0;
      var recent  = expData.recent || [];
      var ivrExps = await kvGet('vaad:ivr_expenses') || [];
      total += ivrExps.reduce(function(s,e){ return s+(e.amount||0); }, 0);
      var allRecent = sortByDate(ivrExps.concat(recent)).slice(0,5);
      var expLines = allRecent.map(function(e) {
        return hebrewDate(e.date) + ': ' + (e.desc||'הוצאה') + ' — ' + (e.amount||0) + ' שקלים.';
      }).join(' ');
      return res.send('הוצאות הבניין הכוללות עומדות על ' + total + ' שקלים. ' +
                      (allRecent.length ? 'ההוצאות האחרונות: ' + expLines : ''));
    }
 
    if (step === 'announcement') {
      return res.send(announcement || 'אין הודעה חדשה מהועד הבית.');
    }
 
    // ════════════════════════════════════════════════
    // שלוחות ועד בית (8/7)
    // ════════════════════════════════════════════════
 
    // 8/7/1 — רישום תשלום מזומן
    if (step === 'addpay') {
      var resPhone = req.query.resphone || '';
      // קרא סכום שמור זמנית או מ-ApiDig ישירות
      var tempKeyP = 'vaad:temp_amount:' + (phone || 'unknown');
      var savedAmtP = await kvGet(tempKeyP);
      var amount  = parseInt(savedAmtP || req.query.ApiDig || '0') || 0;
      if (!amount) return res.send('לא נמצא סכום תקין. אנא נסה שנית.');
      await kvSet(tempKeyP, null);
      var target = resPhone ? findResident(residents, normalizePhone(resPhone)) : null;
      var rName  = target ? target.name : 'דייר לא ידוע';
      var ivrPay = { phone: resPhone, name: rName, amount: amount,
                     date: todayStr(), note: 'מזומן IVR', id: 'ivr_' + Date.now() };
      var ivrPays = await kvGet('vaad:ivr_payments') || [];
      ivrPays.push(ivrPay);
      await kvSet('vaad:ivr_payments', ivrPays);
      return res.send('תשלום של ' + amount + ' שקלים לדייר ' + rName +
                      ' נרשם בהצלחה בתאריך ' + todayStr() + '. תודה.');
    }
 
    // 8/7/2 — שמירת סכום זמני (שלב א)
    if (step === 'save_amount') {
      var amt = parseInt(req.query.ApiDig || '0') || 0;
      if (!amt) return res.send('לא הוקש סכום תקין. חוזר לתפריט.');
      // שמור זמנית לפי טלפון
      var tempKey = 'vaad:temp_amount:' + (phone || 'unknown');
      await kvSet(tempKey, amt);
      return res.send(''); // המשך לשלוחה הבאה
    }
 
    // 8/7/2 — רישום הוצאה
    if (step === 'addexpense') {
      // קרא סכום שנשמר זמנית בשלב הקודם
      var tempKey2 = 'vaad:temp_amount:' + (phone || 'unknown');
      var savedAmt = await kvGet(tempKey2);
      var amount2  = parseInt(savedAmt || req.query.ApiDig || '0') || 0;
      // תיאור ההוצאה: מתמלול דיבור (ApiSpeechResult) או מטקסט (desc)
      var desc2   = (req.query.ApiSpeechResult || req.query.desc || '').trim() || 'הוצאה כללית';
      if (!amount2) return res.send('לא נמצא סכום תקין. אנא נסה שנית.');
      // מחק מפתח זמני
      await kvSet(tempKey2, null);
      var ivrExp = { amount: amount2, desc: desc2, date: todayStr(),
                     cat: 'IVR', id: 'ivr_' + Date.now() };
      var ivrExps2 = await kvGet('vaad:ivr_expenses') || [];
      ivrExps2.push(ivrExp);
      await kvSet('vaad:ivr_expenses', ivrExps2);
      return res.send('הוצאה של ' + amount2 + ' שקלים עבור ' + desc2 +
                      ' נרשמה בהצלחה בתאריך ' + todayStr() + '. תודה.');
    }
 
    // 8/7/3 — 10 הוצאות אחרונות
    if (step === 'vaad_expenses') {
      var allExps = await kvGet('vaad:ivr_expenses') || [];
      var siteExps = (expData.recent || []);
      var combined = sortByDate(allExps.concat(siteExps)).slice(0,10);
      if (!combined.length) return res.send('לא נמצאו הוצאות רשומות במערכת.');
      var lines3 = combined.map(function(e, i) {
        return (i+1) + '. ' + hebrewDate(e.date) + ': ' + (e.desc||'הוצאה') +
               ', ' + (e.amount||0) + ' שקלים.';
      });
      var total3 = combined.reduce(function(s,e){ return s+(e.amount||0); }, 0);
      return res.send('10 ההוצאות האחרונות. סה"כ: ' + total3 + ' שקלים. ' +
                      lines3.join(' ') + ' סוף רשימה.');
    }
 
    // 8/7/4 — 10 תשלומי מזומן אחרונים
    if (step === 'vaad_cashpays') {
      var cashPays = await kvGet('vaad:ivr_payments') || [];
      var sorted   = sortByDate(cashPays).slice(0,10);
      if (!sorted.length) return res.send('לא נמצאו תשלומי מזומן רשומים דרך הטלפון.');
      var lines4 = sorted.map(function(p, i) {
        return (i+1) + '. ' + hebrewDate(p.date) + ': ' + (p.name||'?') +
               ', ' + (p.amount||0) + ' שקלים.';
      });
      var total4 = sorted.reduce(function(s,p){ return s+(p.amount||0); }, 0);
      return res.send('10 תשלומי המזומן האחרונים. סה"כ: ' + total4 + ' שקלים. ' +
                      lines4.join(' ') + ' סוף רשימה.');
    }
 
    // 8/7/5 — צינתוק לדייר לפי מספר דירה
    // ימות שולח: ApiDig = מספר הדירה שהוקש
    if (step === 'zinguk') {
      var aptNum = req.query.ApiDig || '';
      if (!aptNum) {
        // בקשה ראשונה — בקש להקיש מספר דירה
        return res.send('id_list_message=t-הקש את מספר הדירה ולחץ סולמית.&read=1&read_max=3&read_min=1&go_to_folder=/8/7/5&api_add_0=step=zinguk&');
      }
      var target2 = findResidentByApt(residents, aptNum);
      if (!target2) {
        return res.send('דירה מספר ' + aptNum + ' לא נמצאה במערכת.');
      }
      var targetPhone = normalizePhone(target2.phone || target2.phone2 || '');
      if (!targetPhone) {
        return res.send('לדייר בדירה ' + aptNum + ' לא רשום מספר טלפון במערכת.');
      }
      // ימות: call_extension מתקשר לדייר
      return res.send('id_list_message=t-מצלצל לדייר ' + target2.name +
                      ' בדירה ' + aptNum + '.&call_extension=' + targetPhone + '&');
    }
 
    // ── endpoint לקריאת נתוני IVR מהאתר ──────────────────────────────────
    if (step === 'get_ivr_payments') {
      if ((req.query.secret || '') !== SECRET)
        return res.status(401).send('Unauthorized');
      var ivrP = await kvGet('vaad:ivr_payments') || [];
      var ivrE = await kvGet('vaad:ivr_expenses') || [];
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      return res.send(JSON.stringify({ payments: ivrP, expenses: ivrE }));
    }
 
    return res.send('id_list_message=t-שגיאה במערכת. אנא נסה שנית.&');
 
  } catch(e) {
    console.log('IVR ERROR:', e.message);
    return res.send('id_list_message=t-שגיאה במערכת.&');
  }
}
