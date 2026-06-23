
const express = require('express');
const app = express();
 
// CORS — allow requests from any browser
app.use(function(req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});
 
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
 
let residents = [];
 
function normPhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[\s\-]/g, '');
  if (s.startsWith('+972')) s = '0' + s.slice(4);
  if (s.startsWith('972'))  s = '0' + s.slice(3);
  return s;
}
 
function findByPhone(phone) {
  const np = normPhone(phone);
  return residents.find(r =>
    normPhone(r.phone) === np || normPhone(r.phone2) === np
  );
}
 
function fmtMoney(n) {
  return Math.round(n).toLocaleString('he-IL');
}
 
// IVR endpoint — Yemot calls this
app.get('/ivr', (req, res) => {
  const callerPhone = req.query.phone || req.query.caller || '';
  const r = findByPhone(callerPhone);
 
  if (!r) {
    return res.json({
      response_type: 'read',
      text: 'שלום. מספר הטלפון שלך לא נמצא במערכת ועד הבית. אנא פנה לוועד הבית לעדכון פרטיך. להתראות.',
      lang: 'he-IL'
    });
  }
 
  const debt    = Math.round(r.expected - r.paid);
  const hasDebt = debt > 0;
  let text;
 
  if (hasDebt) {
    text = `שלום ${r.name}, דירה ${r.apt}. ` +
           `שילמת עד כה ${fmtMoney(r.paid)} שקל. ` +
           `יתרת החוב שלך היא ${fmtMoney(debt)} שקל. ` +
           `אנא הסדר את התשלום בהקדם. תודה ועד הבית.`;
  } else {
    const credit = Math.abs(debt);
    text = `שלום ${r.name}, דירה ${r.apt}. ` +
           `חשבונך מעודכן. שילמת ${fmtMoney(r.paid)} שקל. ` +
           (credit > 0 ? `יש לך זכות של ${fmtMoney(credit)} שקל. ` : '') +
           `תודה ועד הבית.`;
  }
 
  res.json({ response_type: 'read', text, lang: 'he-IL' });
});
 
// Update residents from the admin site
const API_SECRET = process.env.API_SECRET || 'vaad1919';
 
app.post('/update-residents', (req, res) => {
  if (req.body.apiKey !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  residents = req.body.residents || [];
  console.log(`Updated: ${residents.length} residents`);
  res.json({ ok: true, count: residents.length });
});
 
// Health check
app.get('/', (req, res) => {
  res.json({ status: 'ok', residents: residents.length, time: new Date().toISOString() });
});
 
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Vaad IVR running on port ${PORT}`));
