let residents = global.residents || [];

function normPhone(p) {
  if (!p) return '';
  let s = String(p).replace(/[\s\-]/g, '');
  if (s.startsWith('+972')) s = '0' + s.slice(4);
  if (s.startsWith('972'))  s = '0' + s.slice(3);
  return s;
}

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const phone = req.query.phone || req.query.caller || '';
  const np = normPhone(phone);
  const r = (global.residents||[]).find(r =>
    normPhone(r.phone) === np || normPhone(r.phone2) === np
  );

  if (!r) {
    return res.json({
      response_type: 'read',
      text: 'שלום. מספר הטלפון שלך לא נמצא במערכת ועד הבית. אנא פנה לוועד הבית.',
      lang: 'he-IL'
    });
  }

  const debt = Math.round(r.expected - r.paid);
  const text = debt > 0
    ? `שלום ${r.name}, דירה ${r.apt}. יתרת החוב שלך היא ${Math.round(debt).toLocaleString()} שקל. אנא הסדר בהקדם. תודה ועד הבית.`
    : `שלום ${r.name}, דירה ${r.apt}. חשבונך מעודכן. שילמת ${Math.round(r.paid).toLocaleString()} שקל. תודה ועד הבית.`;

  res.json({ response_type: 'read', text, lang: 'he-IL' });
}
