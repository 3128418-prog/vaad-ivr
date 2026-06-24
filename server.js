const express = require('express');
const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// CORS - allow requests from the netlify site
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

// In-memory storage (persists while server is running)
let ivrData = {
  residents: [],      // array of resident objects
  announcement: '',   // general announcement from vaad
  lastUpdated: null
};

const API_SECRET = process.env.API_SECRET || 'vaad123';

// ─────────────────────────────────────────────
// POST /update  — called by the website to push data
// Body: { secret, residents, announcement }
// ─────────────────────────────────────────────
app.post('/update', (req, res) => {
  const { secret, residents, announcement } = req.body;

  if (secret !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  if (residents) ivrData.residents = residents;
  if (announcement !== undefined) ivrData.announcement = announcement;
  ivrData.lastUpdated = new Date().toISOString();

  console.log(`Data updated: ${ivrData.residents.length} residents`);
  res.json({ ok: true, count: ivrData.residents.length });
});

// ─────────────────────────────────────────────
// GET /health  — connection test from website
// ─────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    residents: ivrData.residents.length,
    lastUpdated: ivrData.lastUpdated
  });
});

// ─────────────────────────────────────────────
// GET /ivr?phone=XXXXXXXXXX  — called by Yemot HaMashiach
// Returns VXML-style text commands for the IVR
// ─────────────────────────────────────────────
app.get('/ivr', (req, res) => {
  const phone = normalizePhone(req.query.phone || '');
  const step = req.query.step || 'menu';
  const digit = req.query.digit || '';

  console.log(`IVR call: phone=${phone} step=${step} digit=${digit}`);

  // Find resident by phone
  const resident = findResident(phone);

  if (step === 'menu') {
    return handleMenu(req, res, resident);
  }
  if (step === 'debt') {
    return handleDebt(req, res, resident);
  }
  if (step === 'payments') {
    return handlePayments(req, res, resident);
  }
  if (step === 'complaint') {
    return handleComplaint(req, res, resident, digit);
  }
  if (step === 'announcement') {
    return handleAnnouncement(req, res);
  }

  // Default
  return handleMenu(req, res, resident);
});

// ─────────────────────────────────────────────
// IVR Step Handlers (Yemot HaMashiach format)
// ─────────────────────────────────────────────

function handleMenu(req, res, resident) {
  const name = resident ? resident.name : 'דייר יקר';
  const baseUrl = getBaseUrl(req);

  let text = `שלום ${name}. `;
  text += 'לשמיעת יתרת החוב לחץ 1. ';
  text += 'לשמיעת תשלומים אחרונים לחץ 2. ';
  text += 'לדיווח על תקלה לחץ 3. ';
  text += 'לשמיעת הודעה מהועד לחץ 4. ';
  text += 'לחזרה לתפריט לחץ 0.';

  const response = yemotMenu(text, {
    '1': `${baseUrl}/ivr?phone=${req.query.phone}&step=debt`,
    '2': `${baseUrl}/ivr?phone=${req.query.phone}&step=payments`,
    '3': `${baseUrl}/ivr?phone=${req.query.phone}&step=complaint`,
    '4': `${baseUrl}/ivr?phone=${req.query.phone}&step=announcement`,
    '0': `${baseUrl}/ivr?phone=${req.query.phone}&step=menu`,
  });

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(response);
}

function handleDebt(req, res, resident) {
  const baseUrl = getBaseUrl(req);
  let text;

  if (!resident) {
    text = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית. ';
  } else {
    const balance = Math.round(resident.balance || 0);
    if (balance <= 0) {
      text = `שלום ${resident.name}. חשבונך מאוזן. אין חוב פתוח. תודה. `;
    } else {
      text = `שלום ${resident.name}. יתרת החוב שלך היא ${balance} שקלים. אנא סדר את התשלום בהקדם. `;
    }
  }

  text += 'לחזרה לתפריט לחץ 0.';
  const response = yemotMenu(text, {
    '0': `${baseUrl}/ivr?phone=${req.query.phone}&step=menu`,
  });

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(response);
}

function handlePayments(req, res, resident) {
  const baseUrl = getBaseUrl(req);
  let text;

  if (!resident) {
    text = 'מספר הטלפון שלך אינו מזוהה במערכת. אנא פנה לועד הבית. ';
  } else {
    const payments = (resident.payments || [])
      .slice(-3) // last 3 payments
      .reverse();

    if (payments.length === 0) {
      text = `שלום ${resident.name}. לא נמצאו תשלומים במערכת. `;
    } else {
      text = `שלום ${resident.name}. התשלומים האחרונים שלך: `;
      payments.forEach((p) => {
        const date = formatDate(p.date);
        const amount = Math.round(p.amount);
        text += `${date} — ${amount} שקלים. `;
      });
    }
  }

  text += 'לחזרה לתפריט לחץ 0.';
  const response = yemotMenu(text, {
    '0': `${baseUrl}/ivr?phone=${req.query.phone}&step=menu`,
  });

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(response);
}

function handleComplaint(req, res, resident, digit) {
  const baseUrl = getBaseUrl(req);

  // Log the complaint (in production you'd save this to a DB or send email)
  const phone = normalizePhone(req.query.phone || '');
  const name = resident ? resident.name : phone;
  console.log(`COMPLAINT received from: ${name} (${phone}) at ${new Date().toISOString()}`);

  const text =
    'תלונתך התקבלה ותועברה לועד הבית. ' +
    'ועד הבית יחזור אליך בהקדם. תודה. ' +
    'לחזרה לתפריט לחץ 0.';

  const response = yemotMenu(text, {
    '0': `${baseUrl}/ivr?phone=${req.query.phone}&step=menu`,
  });

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(response);
}

function handleAnnouncement(req, res) {
  const baseUrl = getBaseUrl(req);
  const announcement = ivrData.announcement || 'אין הודעה חדשה מהועד בית כרגע.';

  const text = `הודעה מועד הבית: ${announcement}. לחזרה לתפריט לחץ 0.`;

  const response = yemotMenu(text, {
    '0': `${baseUrl}/ivr?phone=${req.query.phone}&step=menu`,
  });

  res.set('Content-Type', 'text/plain; charset=utf-8');
  res.send(response);
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function normalizePhone(phone) {
  // Remove leading + or 972, keep 10 digits starting with 05
  phone = phone.replace(/\D/g, '');
  if (phone.startsWith('972')) phone = '0' + phone.slice(3);
  return phone;
}

function findResident(phone) {
  if (!phone) return null;
  return ivrData.residents.find((r) => {
    const p1 = normalizePhone(r.phone1 || '');
    const p2 = normalizePhone(r.phone2 || '');
    return p1 === phone || p2 === phone;
  }) || null;
}

function formatDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return `${d.getDate()} ב${monthName(d.getMonth())} ${d.getFullYear()}`;
}

function monthName(m) {
  const months = ['ינואר','פברואר','מרץ','אפריל','מאי','יוני',
                  'יולי','אוגוסט','ספטמבר','אוקטובר','נובמבר','דצמבר'];
  return months[m] || '';
}

function getBaseUrl(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https';
  return `${proto}://${req.headers.host}`;
}

// Build a Yemot HaMashiach response string
// Yemot uses a simple text protocol: read text then route by digit pressed
function yemotMenu(text, routes) {
  // Yemot format: id_list_message,<encoded_text>,<digit>=<url>,...
  let out = `id_list_message,1,${encodeYemot(text)}`;
  out += '\n';
  // digit routing
  const routeLines = Object.entries(routes)
    .map(([digit, url]) => `${digit}=${url}`)
    .join(',');
  out += `id_list_ivr,${routeLines}`;
  return out;
}

function encodeYemot(text) {
  // Yemot reads TTS text — just return the text as-is (UTF-8 Hebrew)
  return text;
}

// ─────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✅ IVR Server running on port ${PORT}`);
});
