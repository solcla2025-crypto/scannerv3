export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Responde **SOLO** con JSON válido.

Usa exactamente estas palabras:
- "signal": "COMPRA" o "VENTA" o "COMPRA EN RETROCESO" o "VENTA EN RETROCESO" o "ESPERAR"

Llena todos los números: entry, entry_max, sl, tp1, tp2, tp3.

Precio actual: ${livePrice}.`;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session } = req.body || {};
    if (!livePrice) return res.status(400).json({ error: 'Falta precio' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API Key no configurada' });

    const fullPrompt = SOLCLA_PROMPT.replace('${livePrice}', livePrice) + 
      `\nPrecio: ${livePrice} | Últimas velas: ${candles ? candles.slice(-10).map(c => c.close.toFixed(1)).join(" ") : ''}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 800,
        temperature: 0.3,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      return res.status(502).json({ error: 'Error de Anthropic' });
    }

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON' });

    let signal = JSON.parse(rawText.substring(start, end + 1));

    // FIXES
    signal.signal = signal.signal || 'COMPRA';
    signal.confidence = signal.confidence || 65;
    signal.entry = signal.entry || Number(livePrice) - 2;
    signal.entry_max = signal.entry_max || Number(livePrice) + 3;
    signal.sl = signal.sl || (signal.signal.includes('VENTA') ? Number(livePrice) + 8 : Number(livePrice) - 8);
    signal.tp1 = signal.tp1 || (signal.signal.includes('VENTA') ? Number(livePrice) - 12 : Number(livePrice) + 12);

    res.json({ ok: true, signal });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
