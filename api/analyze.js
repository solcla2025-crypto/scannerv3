export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos operativa y decisiva. Prefieres dar señales (COMPRA o VENTA) cuando hay momentum.

**REGLA:** Solo usás ESPERAR si realmente no hay dirección clara. Si hay impulso o rechazo, das señal.

Responde SOLO con JSON:

{
  "signal": "VENTA",
  "confidence": 68,
  "riesgo": "NORMAL",
  "entry": 4041.5,
  "entry_max": 4044,
  "sl": 4049,
  "tp1": 4034,
  "tp2": 4027,
  "tp3": 4018,
  "tp4": 0,
  "tp5": 0,
  "rr_ratio": "1:2",
  "summary": "breve",
  "contexto": "breve"
}

Precio actual: ${livePrice}. Sesión: ${session}.`;

function buildCandleBlock(candles, interval = '5m') {
  const last = candles.slice(-25);
  return `\nVelas recientes: ${last.map(c => c.close.toFixed(1)).join(" ")}`;
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
        max_tokens: 800,
        temperature: 0.4,
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

    safeSignal.confidence = safeSignal.confidence || 62;

    if (!safeSignal.signal || safeSignal.signal === 'undefined') {
      safeSignal.signal = 'VENTA';
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
