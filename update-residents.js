const API_SECRET = process.env.API_SECRET || 'vaad1919';

export default function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { apiKey, residents } = req.body;
  if (apiKey !== API_SECRET) return res.status(401).json({ error: 'Unauthorized' });

  global.residents = residents || [];
  console.log(`Updated: ${global.residents.length} residents`);
  res.json({ ok: true, count: global.residents.length });
}
