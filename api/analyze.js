export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Responde **SOLO** con JSON válido.

{
  "signal": "VENTA EN RETROCESO",
  "confidence": 65,
  "riesgo": "NORMAL",
  "entry": 4048.5,
  "entry_max": 4053.5,
  "sl": 4058,
  "tp1": 4042.8,
  "tp2": 4036.8,
  "tp3": 4028.0,
  "tp4": 0,
  "tp5": 0,
  "rr_ratio": "1:2",
  "summary": "texto corto",
  "contexto": "texto",
  "evitar": "texto",
  "escenario_compra": "texto",
  "escenario_venta": "texto"
}

Precio actual: ${livePrice}. Sesión: ${session}.`;

function buildCandleBlock(candles, interval = '5m') {
  const last = candles.slice(-20);
  return `\nÚltimas velas: ${last.map(c => c.close.toFixed(1)).join(" ")}`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session, hora, mktCtx, memoryStats, mode, interval } = req.body || {};
    if (!candles?.length || !livePrice) return res.status(400).json({ error: 'Faltan datos' });

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'API Key no configurada' });

    const fullPrompt = SOLCLA_PROMPT.replace('${livePrice}', livePrice).replace('${session}', session) + buildCandleBlock(candles, interval);

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 900,
        temperature: 0.2,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    let rawText = data.content?.[0]?.text || '';

    rawText = rawText.trim();
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error("Raw:", rawText);
      return res.status(502).json({ error: 'Sin JSON' });
    }

    const signal = JSON.parse(rawText.substring(start, end + 1));

    const safeSignal = { ...signal };

    // Fixes finales
    safeSignal.confidence = safeSignal.confidence || 62;
    if (!safeSignal.signal || typeof safeSignal.signal !== 'string') safeSignal.signal = 'ESPERAR';

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
