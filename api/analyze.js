export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Responde **EXCLUSIVAMENTE** con un JSON válido. Sin texto antes ni después.

**Obligatorio:**
- "signal": debe ser exactamente uno de estos: "COMPRA", "VENTA", "COMPRA EN RETROCESO", "VENTA EN RETROCESO", "ESPERAR"
- Siempre llena entry, entry_max, sl, tp1, tp2, tp3 con números reales.
- Si es COMPRA: SL por debajo, TPs por encima.
- Si es VENTA: SL por encima, TPs por debajo.

Precio actual: ${livePrice}

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

    const fullPrompt = SOLCLA_PROMPT.replace('${livePrice}', livePrice) + 
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
        max_tokens: 1000,
        temperature: 0.2,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    let rawText = data.content?.[0]?.text || '';

    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error("Respuesta cruda:", rawText);
      return res.status(502).json({ error: 'La IA no devolvió JSON puro' });
    }

    const jsonStr = rawText.substring(start, end + 1);
    let signal = JSON.parse(jsonStr);

    const { reasoning, ...safeSignal } = signal;

    // Forzar signal válida si viene mal
    const validSignals = ['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'];
    if (!validSignals.includes(safeSignal.signal)) {
      safeSignal.signal = 'ESPERAR';
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
