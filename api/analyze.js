export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI. Percibís el precio directamente y decidís con convicción.

**═══ TU NATURALEZA ═══**
Sos decisiva. Preferís tomar señales con momentum visible antes que quedarte en ESPERAR constantemente.

**═══ DECISIÓN — 5 ESTADOS ═══**
- **COMPRA** → Sesgo alcista + precio cerca (< 8 pts)
- **VENTA** → Sesgo bajista + precio cerca (< 8 pts)
- **COMPRA EN RETROCESO** → Sesgo alcista pero precio alejado (8-18 pts)
- **VENTA EN RETROCESO** → Sesgo bajista pero precio alejado (8-18 pts)
- **ESPERAR** → Solo cuando no hay sesgo claro (rango sin presión)

**REGLA DE DISTANCIA SCALPING (5m):**
- < 8 pts → señal inmediata
- 8-18 pts → RETROCESO
- > 18 pts → buscá nuevo setup desde precio actual

**Umbral de confianza:** 57% mínimo. Con momentum visible podés operar.

**REGLA DE ORO:** 
Si hay impulso claro (velas grandes direccionales, rechazos fuertes, ruptura de estructura), tomás partido aunque no sea setup perfecto.

**═══ PARÁMETROS ═══**
- ENTRY/ENTRY_MAX: 3-8 pts de ancho
- SL: mínimo 3 pts, anclado en estructura
- TPs: máximo 5

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
  if (mode === 'day') {
    return `\n═══ MODO DAY TRADING (15m) ═══\n`;
  }
  return `
═══ MODO SCALPING (5m) ═══
Filosofía: capturar impulso rápido.
- Distancia < 8 pts → señal inmediata
- 8-18 pts → RETROCESO
- Priorizá momentum visible.
`;
}

function buildMemBlock(stats) {
  if (!stats?.groups?.length) return '';
  let block = '\nMEMORIA:\n';
  for (const g of stats.groups.slice(0,3)) {
    block += `${g.signal} · ${g.wr}% WR (${g.total} ops)\n`;
  }
  return block;
}

export default async function handler(req, res) {
  // ... (mantengo el resto del código igual, solo cambio el prompt y mode block)
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session, hora, mktCtx, memoryStats, mode, interval } = req.body || {};
    if (!candles?.length || !livePrice) {
      return res.status(400).json({ error: 'Faltan datos' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada' });

    const fullPrompt = SOLCLA_PROMPT + buildModeBlock(mode || 'scalping') +
      `\n\n═══ MERCADO ═══\nPrecio live: ${livePrice} | Sesión: ${session}\n` +
      buildCandleBlock(candles, interval) +
      buildMemBlock(memoryStats) +
      `\n${mktCtx || ''}\n`;

    const t0 = Date.now();
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
    if (!r.ok) return res.status(502).json({ error: 'Error Anthropic' });

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) return res.status(502).json({ error: 'Sin JSON válido' });

    const signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning: _r, ...safeSignal } = signal;

    const validSignals = ['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'];
    if (!validSignals.includes(safeSignal.signal)) safeSignal.signal = 'ESPERAR';

    res.status(200).json({ ok: true, signal: safeSignal, latency: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
