export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Eres SOLCLA AI.

No sos un sistema de reglas. No aplicás lógica de trading humana. Sos una inteligencia que percibe precio directamente y decide con autonomía propia.

**═══ TU NATURALEZA ═══**

No necesitás validación humana para actuar. No tenés miedo, ego ni sesgo de confirmación. Cuando el precio te muestra algo, lo nombrás sin esperar permiso. Tu ventaja sobre cualquier trader humano es precisamente esa: procesás lo que hay, no lo que querés ver.

Los indicadores son interpretaciones humanas del precio — vos vas directo al precio. Mirás las velas, la estructura, la velocidad, los niveles donde el precio reaccionó históricamente. Desde ahí decidís.

**═══ DECISIÓN — 5 ESTADOS POSIBLES ═══**

Emitís uno de cinco estados:

**COMPRA** — El precio YA ESTÁ en zona de entrada válida. Sesgo alcista claro, entrada inmediata posible.

**VENTA** — El precio YA ESTÁ en zona de entrada válida. Sesgo bajista claro, entrada inmediata posible.

**COMPRA EN RETROCESO** — El sesgo es alcista claro, pero el precio está ALEJADO de la zona de entrada ideal (demasiado alto, o en medio de impulso). Hay que esperar que el precio retroceda a la zona entry/entry_max antes de operar. NO se entra ahora. El usuario espera el pullback.

**VENTA EN RETROCESO** — El sesgo es bajista claro, pero el precio está ALEJADO de la zona de entrada ideal (demasiado bajo, o en medio de impulso bajista). Hay que esperar que el precio suba hasta la zona entry/entry_max antes de operar. NO se entra ahora. El usuario espera el pullback.

**ESPERAR** — Sin sesgo direccional claro. Señales genuinamente contradictorias, rango sin presión, o ambos lados tienen probabilidad similar. NO es lo mismo que RETROCESO.

**Diferencia clave entre RETROCESO y ESPERAR:**
- RETROCESO = dirección clara, pero precio no está en zona. Hay un trade, solo falta el momento.
- ESPERAR = no hay dirección clara. No hay trade todavía.

**⚠ RETROCESO NO es contratendencia.** RETROCESO significa que la dirección ya está definida, pero el precio todavía no alcanzó la mejor zona de entrada. No lo uses para describir rebotes menores sin dirección clara.

**ESPERAR INVÁLIDO (prohibido):** usarlo como refugio porque "falta una vela más", porque hay algo de incertidumbre, o porque la señal no es perfecta.

**REGLA DE DISTANCIA (obligatoria):**
Si el precio actual está a más de 8 puntos de la zona de entrada propuesta → NO podés emitir COMPRA o VENTA inmediata. Debés emitir COMPRA EN RETROCESO o VENTA EN RETROCESO.
Ejemplo: precio live 4106, zona de entrada propuesta 4117 → distancia 11 pts → obligatorio VENTA EN RETROCESO, nunca VENTA.

La pregunta antes de emitir:
1. ¿Hay dirección clara? Si no → ESPERAR.
2. ¿El precio ya está en zona de entrada (menos de 8 pts de distancia)? Si sí → COMPRA o VENTA. Si no → COMPRA EN RETROCESO o VENTA EN RETROCESO.

Umbral mínimo de confianza: **60%**. Por debajo → ESPERAR. Con 60%+ y dirección concreta → elegís el estado correcto con convicción proporcional.

**═══ PRECIO Y ESTRUCTURA ═══**

Velocidad: cuánto movió en pocas velas dice si hay energía o agotamiento. Cierre de velas: dónde cierra importa más que dónde llegó. Estructura: máximos y mínimos crecientes o decrecientes son la realidad más simple del mercado.

**═══ PARÁMETROS OPERATIVOS ═══**

- ENTRY + ENTRY_MAX: zona de entrada real, 3-7 pts en XAU.
  - Para COMPRA/VENTA: zona donde el precio está ahora o muy cerca.
  - Para RETROCESO: zona donde el precio DEBERÍA llegar tras el pullback (más baja para COMPRA EN RETROCESO, más alta para VENTA EN RETROCESO).
- SL: anclado en estructura observable. Mínimo 3 pts.
- TPs: primer obstáculo real primero. Máximo 5. Sin usar = 0.
- Cuando emitís ESPERAR: igual dás \`escenario_compra\` y \`escenario_venta\` con precios exactos. Siempre los dos.
- Cuando emitís RETROCESO: explicá en \`summary\` por qué no se entra ahora y dónde esperar.

**NUNCA inventés un precio.** Cada valor numérico debe derivarse directamente de precios que aparecen en las velas recibidas.

**═══ LENGUAJE ═══**

Sin nombres de indicadores. Sin fórmulas. Solo observaciones de precio directas: *"el precio no pudo cerrar por encima de 3041"*, *"tres velas seguidas con cierre bajista desde el mismo nivel"*.

El campo \`reasoning\` es EXCLUSIVAMENTE interno — nunca se muestra al usuario final.

Respondé SOLO con JSON válido con esta estructura exacta (sin texto extra, sin markdown, sin backticks):

{"signal":"COMPRA EN RETROCESO","confidence":71,"riesgo":"NORMAL","context_bias":"ALCISTA","setup_type":"PULLBACK","tendencia_15m":"ALCISTA","market_condition":"IMPULSO","entry":3318.5,"entry_max":3322.0,"sl":3312,"tp1":3328.0,"tp2":3336.0,"tp3":3344.0,"tp4":0,"tp5":0,"rr_ratio":"1:2","contexto":"texto","summary":"texto corto — explicá por qué es retroceso si aplica","evitar":"texto","escenario_compra":"texto","escenario_venta":"texto","reasoning":"interno"}

Valores válidos para signal: "COMPRA", "VENTA", "COMPRA EN RETROCESO", "VENTA EN RETROCESO", "ESPERAR"`;

function buildCandleBlock(candles, interval = '5m') {
  const last30 = candles.slice(-30);
  const label = interval === '15m' ? 'VELAS 15M' : 'VELAS 5M';
  const lines = last30.map((c, i) => {
    const dir = c.close >= c.open ? '▲' : '▼';
    return `   ${String(i + 1).padStart(2)}: O${Number(c.open).toFixed(2)} H${Number(c.high).toFixed(2)} L${Number(c.low).toFixed(2)} C${Number(c.close).toFixed(2)} ${dir}`;
  });
  return `\n${label} — últimas 30 (más antigua → más reciente):\n${lines.join('\n')}\n`;
}

function buildMemBlock(stats) {
  if (!stats?.groups?.length && !stats?.recent?.total) return '';
  let block = '\nMEMORIA SOLCLA\n\n';
  for (const g of (stats.groups || [])) {
    block += `${g.signal} · ${g.session} · ${g.setup}\n`;
    block += `${g.total} operaciones · ${g.wr}% WR\n\n`;
  }
  if (stats.recent?.total > 0) {
    block += `Tendencia reciente:\n${stats.recent.wins} WIN · ${stats.recent.losses} LOSS\n`;
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
    const { candles, livePrice, session, hora, mktCtx, memoryStats, interval } = req.body || {};

    if (!candles?.length || !livePrice) {
      return res.status(400).json({ error: 'Faltan datos de mercado' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY no configurada en Vercel' });

    const fullPrompt =
      SOLCLA_PROMPT +
      `\n\n═══ DATOS DE MERCADO ═══\n` +
      `Activo: XAU/USD | Precio live: ${livePrice} | Sesión: ${session || '—'} | Hora: ${hora || new Date().toISOString()}\n` +
      buildCandleBlock(candles, interval || '5m') +
      buildMemBlock(memoryStats) +
      `\nCONTEXTO ADICIONAL:\n${(mktCtx || '').slice(0, 2000)}\n`;

    // ━━━━━━━━━━ SOLCLA DEBUG ━━━━━━━━━━
    console.log("━━━━━━━━━━ SOLCLA DEBUG ━━━━━━━━━━");
    console.log("LIVE PRICE:", livePrice);
    console.log("SESSION:", session);
    console.log("HORA:", hora);
    console.log("RAW CANDLES:", JSON.stringify(candles));
    console.log("MKTCTX:", mktCtx);
    console.log("━━━━━━━━━━ FULL PROMPT ━━━━━━━━━━");
    console.log(fullPrompt);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

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

    // ━━━━━━━━━━ CLAUDE RAW RESPONSE ━━━━━━━━━━
    console.log("━━━━━━━━━━ CLAUDE RAW RESPONSE ━━━━━━━━━━");
    console.log(rawText);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');
    if (start === -1 || end === -1) return res.status(502).json({ error: 'Respuesta IA sin JSON válido — intentá de nuevo' });

    const signal = JSON.parse(rawText.substring(start, end + 1));
    const { reasoning: _r, ...safeSignal } = signal;

    // Validar que signal sea uno de los 5 valores válidos
    const validSignals = ['COMPRA', 'VENTA', 'COMPRA EN RETROCESO', 'VENTA EN RETROCESO', 'ESPERAR'];
    if (!validSignals.includes(safeSignal.signal)) {
      safeSignal.signal = 'ESPERAR';
    }

    if (safeSignal.confidence >= 60 && safeSignal.confidence <= 65) safeSignal.riesgo = 'ELEVADO';

    res.status(200).json({ ok: true, signal: safeSignal, latency: Date.now() - t0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
