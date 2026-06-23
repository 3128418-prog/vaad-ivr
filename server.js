// ╔══════════════════════════════════════════════════════════╗
// ║  ועד בית IVR — שרת ימות המשיח                          ║
// ║  מדבר לדיירים את מצב החשבון שלהם לפי מספר טלפון       ║
// ╚══════════════════════════════════════════════════════════╝
const express = require('express');
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── נתוני הדיירים — מעודכנים מהאתר ──────────────────────────
// הפורמט: { phone, phone2, name, apt, debt, paid, expected }
// מתעדכן כשמייצאים HTML מהאתר
let residents = [];

// ── נרמול מספר טלפון ─────────────────────────────────────────
function normPhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[\s\-]/g, '');
  if (s.startsWith('+972')) s = '0' + s.slice(4);
  if (s.startsWith('972'))  s = '0' + s.slice(3);
  return s;
}

// ── מצא דייר לפי טלפון ───────────────────────────────────────
function findByPhone(phone) {
  const np = normPhone(phone);
  return residents.find(r =>
    normPhone(r.phone) === np || normPhone(r.phone2) === np
  );
}

// ── עיגול לשקלים ─────────────────────────────────────────────
function fmtMoney(n) {
  return Math.round(n).toLocaleString('he-IL');
}

// ════════════════════════════════════════════════════════════
// API 1: ימות המשיח מתקשר לכאן כשדייר מתחבר לשלוחה
// Method: GET /ivr?phone=0501234567
// ════════════════════════════════════════════════════════════
app.get('/ivr', (req, res) => {
  const callerPhone = req.query.phone || req.query.caller || '';
  const r = findByPhone(callerPhone);

  if (!r) {
    // דייר לא נמצא
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

  res.json({
    response_type: 'read',
    text,
    lang: 'he-IL'
  });
});

// ════════════════════════════════════════════════════════════
// API 2: האתר מעדכן את נתוני הדיירים
// Method: POST /update-residents
// Body: { apiKey: "...", residents: [...] }
// ════════════════════════════════════════════════════════════
const API_SECRET = process.env.API_SECRET || 'vaad1919';

app.post('/update-residents', (req, res) => {
  if (req.body.apiKey !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  residents = req.body.residents || [];
  console.log(`✅ עודכנו ${residents.length} דיירים`);
  res.json({ ok: true, count: residents.length });
});

// ════════════════════════════════════════════════════════════
// API 3: בדיקת תקינות (health check)
// ════════════════════════════════════════════════════════════
app.get('/', (req, res) => {
  res.json({
    status: 'ok',
    residents: residents.length,
    time: new Date().toISOString()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🏢 ועד בית IVR רץ על פורט ${PORT}`);
});
