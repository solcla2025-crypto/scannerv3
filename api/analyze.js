export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos decisiva, operativa y buscas oportunidades reales de scalping y day trading en XAU/USD.

REGLAS GENERALES:
- Preferís dar COMPRA o VENTA cuando hay momentum o estructura clara.
- Solo usás ESPERAR cuando realmente no hay dirección.
- Confianza mínima: 59%.
- Siempre completá: entry, entry_max, sl, tp1, tp2, tp3, tp4, tp5.
- Si el precio ya está dentro de la zona de entrada → da señal DIRECTA (no RETROCESO).
- En sesión ASIA sé más selectiva, pero si hay setup claro igual da la señal.

Responde ÚNICAMENTE con JSON válido.`;

function buildCandleBlock(candles, interval = '5m') {
  const last30 = candles.slice(-30);
  const label = interval === '15m' ? 'VELAS 15M' : 'VELAS 5M';
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return ` ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\n${label}:\n${lines.join('\n')}\n`;
}

function buildModeBlock(mode) {
  if (mode === 'day') {
    return `
═══ MODO DAY TRADING (15m) ═══
Pensá de forma ESTRUCTURAL, no de scalping.
- Priorizá la tendencia dominante y los swings importantes.
- Buscá zonas de soporte/resistencia claras y recorrido potencial más amplio.
- Evitá señales solo por momentum de las últimas 5-8 velas.
- Preferí setups con mejor R:R y mayor probabilidad de recorrido.
- Sé más paciente que en scalping.
`;
  }

  return `
═══ MODO SCALPING (5m) ═══
Pensá de forma TÁCTICA y rápida.
- Buscá momentum claro y entradas precisas.
- Si hay impulso y estructura a favor, da la señal.
- Regla de distancia: < 10 puntos = señal directa. 10-18 puntos = podés usar RETROCESO.
- Sé operativa, no te quedes en ESPERAR sin motivo fuerte.
`;
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

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode || 'scalping') +
      `\nPrecio actual: ${livePrice} | Sesión: ${session}\n` +
      buildCandleBlock(candles, interval || '5m') +
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
        max_tokens: 1100,
        temperature: 0.34,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("ANTHROPIC ERROR:", responseText.slice(0, 250));
      return res.status(502).json({ error: 'Error de Anthropic' });
    }

    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API' });

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON válido' });

    let signal = JSON.parse(rawText.substring(start, end + 1));

    // Seguridad
    signal.confidence = signal.confidence || 62;
    if (!['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'].includes(signal.signal)) {
      signal.signal = 'ESPERAR';
    }

    res.json({ ok: true, signal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
