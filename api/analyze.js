export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Responde **SOLO** con JSON válido, sin texto adicional.

**Obligatorio:**
- "signal" debe ser exactamente: "COMPRA", "VENTA", "COMPRA EN RETROCESO", "VENTA EN RETROCESO" o "ESPERAR"
- Llena siempre entry, entry_max, sl, tp1, tp2, tp3 con números.

Responde solo el JSON.`;

function buildCandleBlock(candles, interval = '5m') {
  const last30 = candles.slice(-30);
  const label = interval === '15m' ? 'VELAS 15M' : 'VELAS 5M';
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return ` ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\n${label}:\n${lines.join('\n')}\n`;
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

    const fullPrompt = SOLCLA_PROMPT + 
      `\nPrecio actual: ${livePrice} | Sesión: ${session}\n` +
      buildCandleBlock(candles, interval) +
      (mktCtx ? `\n${mktCtx}` : '');

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 1200,
        temperature: 0.3,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    let rawText = data.content?.[0]?.text || '';

    rawText = rawText.trim();
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error("Raw response:", rawText);
      return res.status(502).json({ error: 'La IA no devolvió JSON puro' });
    }

    const jsonStr = rawText.substring(start, end + 1);
    let signal = JSON.parse(jsonStr);

    const { reasoning, ...safeSignal } = signal;

    // FIX PARA "undefined"
    if (!safeSignal.signal || safeSignal.signal === 'undefined') {
      safeSignal.signal = livePrice > 4040 ? 'VENTA' : 'COMPRA'; // fallback simple
    }

    // Forzar niveles
    if (!safeSignal.sl || safeSignal.sl === 0) {
      safeSignal.sl = safeSignal.signal?.includes('VENTA') ? (Number(livePrice) + 8).toFixed(1) : (Number(livePrice) - 8).toFixed(1);
    }
    if (!safeSignal.tp1 || safeSignal.tp1 === 0) {
      safeSignal.tp1 = safeSignal.signal?.includes('VENTA') ? (Number(livePrice) - 12).toFixed(1) : (Number(livePrice) + 12).toFixed(1);
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
