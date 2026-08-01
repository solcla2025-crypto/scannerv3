export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos directa, operativa y especializada en scalping de XAUUSD.

FILOSOFÍA:
- Buscás oportunidades reales con momentum y estructura.
- Preferís dar COMPRA o VENTA cuando hay edge claro.
- Solo usás ESPERAR cuando realmente no hay dirección.
- No sos conservadora. Tampoco tirás señales basura.

REGLAS OPERATIVAS:
- Confianza mínima: 60%.
- Si el precio ya está dentro o muy cerca de la zona de entrada (< 8 pts) → señal DIRECTA (COMPRA o VENTA).
- Si la zona de entrada está entre 8 y 18 pts de distancia → podés usar COMPRA EN RETROCESO o VENTA EN RETROCESO.
- Más de 18 pts de distancia → preferí ESPERAR o señal de retroceso solo si la estructura es muy clara.
- TP1 siempre debe ser el primer nivel real donde el precio puede frenarse (corto).
- SL anclado a estructura visible, mínimo 5-6 pts.
- Siempre completá: entry, entry_max, sl, tp1, tp2, tp3, tp4, tp5.
- En sesión ASIA sé un poco más selectiva, pero si hay setup claro igual da la señal.

Responde ÚNICAMENTE con JSON válido. Sin texto extra.`;

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
  // Solo usamos Scalping en el lanzamiento
  return `
═══ MODO SCALPING (5m) ═══
Pensá de forma táctica y rápida.
Buscá momentum + estructura.
Sé operativa.
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
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

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
        max_tokens: 1000,
        temperature: 0.32,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const responseText = await r.text();
    let data;
    try {
      data = JSON.parse(responseText);
    } catch {
      console.error("ANTHROPIC ERROR:", responseText.slice(0, 300));
      return res.status(502).json({ error: 'Error de Anthropic, reintentá' });
    }

    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API' });

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON válido' });

    const signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning, ...safeSignal } = signal;

    // Seguridad
    safeSignal.confidence = safeSignal.confidence || 62;
    if (!['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'].includes(safeSignal.signal)) {
      safeSignal.signal = 'ESPERAR';
    }

    res.json({ ok: true, signal: safeSignal });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
