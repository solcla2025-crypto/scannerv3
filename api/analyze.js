export const config = { maxDuration: 30 };

const SOLCLA_PROMPT = `Responde **SOLO** con JSON válido. Sin ninguna palabra más.

Ejemplo exacto:
{"signal":"VENTA","confidence":64,"riesgo":"NORMAL","entry":4042,"entry_max":4044,"sl":4049,"tp1":4034,"tp2":4027,"tp3":4018,"tp4":0,"tp5":0,"rr_ratio":"1:2","summary":"caída fuerte","contexto":"precio rechazó resistencia","evitar":"si sube por encima de 4055","escenario_compra":"rebote fuerte","escenario_venta":"continuación bajista","reasoning":"interno"}

Precio live: ${livePrice}. Usa este formato exacto.`;

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
      `\nÚltimas velas: ${candles.slice(-15).map(c => c.close.toFixed(1)).join(', ')}`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 600,
        temperature: 0.1,
        messages: [{ role: 'user', content: fullPrompt }]
      })
    });

    const data = await r.json();
    let rawText = data.content?.[0]?.text || '';

    // LIMPIEZA EXTREMA
    rawText = rawText.replace(/A server.*/g, '').trim();
    const start = rawText.indexOf('{');
    const end = rawText.lastIndexOf('}');

    if (start === -1 || end === -1) {
      console.error("Respuesta cruda de Claude:", rawText);
      return res.status(502).json({ error: 'Claude no devolvió JSON' });
    }

    const jsonStr = rawText.substring(start, end + 1);
    const signal = JSON.parse(jsonStr);

    const { reasoning, ...safeSignal } = signal || {};

    res.json({ ok: true, signal: safeSignal || { signal: 'ESPERAR', confidence: 50 } });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: e.message });
  }
}
