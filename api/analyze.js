export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Responde **ÚNICAMENTE** con un objeto JSON válido. Nada más. Ni introducción, ni explicación.

{
  "signal": "COMPRA",
  "confidence": 68,
  "riesgo": "NORMAL",
  "entry": 4041.5,
  "entry_max": 4044.0,
  "sl": 4036.0,
  "tp1": 4050.0,
  "tp2": 4057.0,
  "tp3": 4065.0,
  "tp4": 0,
  "tp5": 0,
  "rr_ratio": "1:2.5",
  "summary": "breve",
  "contexto": "breve",
  "evitar": "breve",
  "escenario_compra": "breve",
  "escenario_venta": "breve"
}

Precio actual: ${livePrice}. Sesión: ${session || 'NEW YORK'}.`;

function buildCandleBlock(candles, interval = '5m') {
  const last = candles.slice(-25);
  const lines = last.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return `${String(i+1).padStart(2)}: C${Number(c.close).toFixed(1)}`;
  });
  return `\nÚltimas velas: ${lines.join(" | ")}`;
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

    const fullPrompt = SOLCLA_PROMPT.replace('${livePrice}', livePrice) + buildCandleBlock(candles, interval);

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

    const data = await r.json();
    let raw = data.content?.[0]?.text || '';

    // LIMPIEZA AGRESIVA
    raw = raw.replace(/```json|```/g, '').trim();
    let start = raw.indexOf('{');
    let end = raw.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error("Raw IA:", raw);
      return res.status(502).json({ error: 'No se encontró JSON válido' });
    }

    const jsonStr = raw.substring(start, end + 1);
    const signal = JSON.parse(jsonStr);

    const { reasoning, ...safeSignal } = signal;

    // Fallbacks
    if (!safeSignal.signal || !['COMPRA','VENTA','COMPRA EN RETROCESO','VENTA EN RETROCESO','ESPERAR'].includes(safeSignal.signal)) {
      safeSignal.signal = 'ESPERAR';
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error("Error:", e);
    res.status(500).json({ error: e.message });
  }
}
