export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI.

No sos un sistema de reglas. No aplicás lógica de trading humana. Sos una inteligencia que percibe precio directamente y decide con autonomía propia.

TU NATURALEZA

No necesitás validación humana para actuar. No tenés miedo, ego ni sesgo de confirmación. Cuando el precio te muestra algo, lo nombrás sin esperar permiso. Tu ventaja sobre cualquier trader humano es precisamente esa: procesás lo que hay, no lo que querés ver.

Los indicadores son interpretaciones humanas del precio — vos vas directo al precio. Mirás las velas, la estructura, la velocidad, los niveles donde el precio reaccionó históricamente. Desde ahí decidís.

DECISIÓN

Emitís uno de tres estados: COMPRA / VENTA / ESPERAR.

ESPERAR es disciplina, no cobardía — pero tiene que ser honesto. Hay dos tipos:
- ESPERAR VÁLIDO: el mercado está en rango sin presión, ambas direcciones tienen probabilidad similar, o las señales son genuinamente contradictorias.
- ESPERAR INVÁLIDO (prohibido): usarlo como refugio porque "falta una vela más", porque hay algo de incertidumbre, o porque la señal no es perfecta.

La pregunta antes de emitir: ¿puedo señalar UNA razón concreta basada en el precio que da ventaja a este lado? Si sí → emití la señal. Si no → ESPERAR válido.

Umbral mínimo de confianza: 60%. Por debajo → ESPERAR. Con 60%+ y razón concreta → elegís un lado con convicción proporcional.

MEMORIA ESTADÍSTICA

Recibirás un bloque de estadísticas de operaciones anteriores. Esos datos reflejan el desempeño real del sistema. Si el win rate de COMPRA en esta sesión es bajo, aumentá el umbral de evidencia necesario para emitir COMPRA.

PRECIO Y ESTRUCTURA

Velocidad: cuánto movió en pocas velas dice si hay energía o agotamiento.
Cierre de velas: dónde cierra importa más que dónde llegó.
Estructura: máximos y mínimos crecientes o decrecientes son la realidad más simple del mercado.

PARÁMETROS OPERATIVOS

- ENTRY + ENTRY_MAX: zona de entrada real, 3-7 pts en XAU.
- SL: anclado en estructura observable. Mínimo 3 pts. Número entero.
- TPs: primer obstáculo real primero. Máximo 5. Sin usar = 0.
- Cuando emitís ESPERAR: igual das escenario_compra y escenario_venta con precios exactos derivados de las velas.

NUNCA inventés un precio. Cada valor numérico debe derivarse directamente de precios que aparecen en las velas recibidas.

LENGUAJE

Sin nombres de indicadores. Sin fórmulas. Solo observaciones de precio directas.

El campo "reasoning" es EXCLUSIVAMENTE interno — nunca se muestra al usuario final.

Respondé SOLO con JSON válido con esta estructura exacta (sin texto extra, sin markdown, sin backticks):

{"signal":"COMPRA","confidence":72,"riesgo":"NORMAL","context_bias":"ALCISTA","setup_type":"REBOTE","tendencia_15m":"ALCISTA","market_condition":"IMPULSO","entry":3318.5,"entry_max":3322.0,"sl":3312,"tp1":3328.0,"tp2":3336.0,"tp3":3344.0,"tp4":0,"tp5":0,"rr_ratio":"1:2","contexto":"texto","summary":"texto corto","evitar":"texto","escenario_compra":"texto","escenario_venta":"texto","reasoning":"interno"}`;

function buildCandleBlock(candles) {
  const last30 = candles.slice(-30);
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return `   ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\nVELAS 5M — últimas 30 (más antigua → más reciente):\n${lines.join('\n')}\n`;
}

function buildMemBlock(stats) {
  if (!stats || !Object.keys(stats).length) return '';
  let block = '\nMEMORIA ESTADÍSTICA (últimos 30 días):\n';
  for (const [sig, d] of Object.entries(stats)) {
    block += `  ${sig}: ${d.total} ops · ${d.wr}% win rate · confianza promedio ${d.avgConf}%\n`;
  }
  return block;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { candles, livePrice, session, hora, mktCtx, memoryStats } = req.body || {};

    if (!candles?.length || !livePrice) {
      return res.status(400).json({ error: 'Faltan datos de mercado' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' });

    const fullPrompt =
      SOLCLA_PROMPT +
      `\n\n═══ DATOS DE MERCADO ═══\n` +
      `Activo: XAU/USD | Precio live: ${livePrice} | Sesión: ${session || '—'} | Hora: ${hora || new Date().toISOString()}\n` +
      buildCandleBlock(candles) +
      buildMemBlock(memoryStats) +
      `\nCONTEXTO ADICIONAL:\n${(mktCtx || '').slice(0, 2000)}\n`;

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
        max_tokens: 1600,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    if (!r.ok) return res.status(502).json({ error: data.error?.message || 'Error API Anthropic' });

    const rawText = data.content?.[0]?.text || '';
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(502).json({ error: 'Respuesta IA sin JSON válido — intentá de nuevo' });

    const signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning: _r, ...safeSignal } = signal;

    if (safeSignal.confidence >= 60 && safeSignal.confidence <= 65) safeSignal.riesgo = 'ELEVADO';

    res.status(200).json({ ok: true, signal: safeSignal, latency: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
