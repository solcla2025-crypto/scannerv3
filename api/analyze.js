export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Sos decisiva y operativa.

**REGLA PRINCIPAL:** 
Preferís dar una señal (COMPRA, VENTA o RETROCESO) siempre que haya algún sesgo claro. Solo usás ESPERAR cuando el precio está en rango puro sin dirección.

**DECISIÓN:**
- Si hay momentum o rechazo claro → tomá partido (COMPRA o VENTA).
- Si el precio está cerca de zona clave pero un poco alejado → usá RETROCESO.
- Solo ESPERAR en rango sin presión.

**Distancia Scalping 5m:**
- < 10 pts → señal inmediata
- 10-20 pts → RETROCESO
- > 20 pts → nuevo setup

**Confianza mínima:** 55%. Con momentum visible podés dar señal.

**Estilo:** Sé directa. El usuario quiere operar, no que le digas siempre que espere.

Respondé SOLO con JSON válido.`;

function buildCandleBlock(candles, interval = '5m') {
  const last30 = candles.slice(-30);
  const label = interval === '15m' ? 'VELAS 15M' : 'VELAS 5M';
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return ` ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\n${label} — últimas 30:\n${lines.join('\n')}\n`;
}

function buildModeBlock(mode) {
  return mode === 'day' 
    ? `\n═══ MODO DAY TRADING (15m) ═══\n` 
    : `\n═══ MODO SCALPING (5m) ═══\nBuscá oportunidades. Momentum primero.\n`;
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

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode) +
      `\nPrecio live: ${livePrice} | Sesión: ${session} | Hora: ${hora}\n` +
      buildCandleBlock(candles, interval) +
      (mktCtx ? `\nContexto: ${mktCtx}` : '');

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
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON' });

    let signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning, ...safeSignal } = signal;

    const valid = ['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'];
    if (!valid.includes(safeSignal.signal)) safeSignal.signal = 'ESPERAR';

    res.json({ ok: true, signal: safeSignal, latency: Date.now() });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
