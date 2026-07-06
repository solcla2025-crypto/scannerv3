// ============================================================================
//  NEXUS QUANTUM  ·  Data Gateway
//  Serverless proxy con datos reales de mercado y sistema de respaldo.
//  Autor: Solcla 🔮
// ============================================================================
//
//  Endpoints:
//    /api/candles?asset=BTC&interval=1m&limit=250
//    /api/candles?asset=XAU&interval=1m&limit=250
//    /api/candles?asset=BTC&mode=ticker
//    /api/candles?asset=XAU&mode=ticker
//
//  Fuentes:
//    BTC: Binance (primaria) → Kraken (respaldo)
//    XAU: Yahoo Finance GC=F (primaria) → Stooq (respaldo)
// ============================================================================

const YAHOO_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/122.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9'
};

const YAHOO_RANGE = { '1m': '1d', '5m': '5d', '15m': '5d', '1h': '1mo', '1d': '3mo' };

// --- Utilidades ----------------------------------------------------------

async function fetchJSON(url, options = {}, timeoutMs = 6000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const r = await fetch(url, { ...options, signal: controller.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(timer);
  }
}

function normalizeInterval(x) {
  const allowed = ['1m', '3m', '5m', '15m', '30m', '1h', '4h', '1d'];
  return allowed.includes(x) ? x : '1m';
}

function clampLimit(n) {
  const v = parseInt(n, 10);
  if (isNaN(v)) return 250;
  return Math.max(30, Math.min(500, v));
}

// --- BTC -----------------------------------------------------------------

async function fetchBTCCandles(interval, limit) {
  // Fuente primaria: Binance
  try {
    const url = `https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${interval}&limit=${limit}`;
    const data = await fetchJSON(url);
    return {
      source: 'binance',
      candles: data.map(k => ({
        time: +k[0],
        open: +k[1],
        high: +k[2],
        low:  +k[3],
        close:+k[4],
        volume:+k[5]
      }))
    };
  } catch (e1) {
    // Fuente respaldo: Kraken
    try {
      const krakenInterval = { '1m':1,'5m':5,'15m':15,'30m':30,'1h':60,'4h':240,'1d':1440 }[interval] || 1;
      const url = `https://api.kraken.com/0/public/OHLC?pair=XBTUSD&interval=${krakenInterval}`;
      const data = await fetchJSON(url);
      const key = Object.keys(data.result).find(k => k !== 'last');
      const raw = data.result[key] || [];
      const candles = raw.slice(-limit).map(k => ({
        time: +k[0] * 1000,
        open: +k[1],
        high: +k[2],
        low:  +k[3],
        close:+k[4],
        volume:+k[6]
      }));
      return { source: 'kraken', candles };
    } catch (e2) {
      throw new Error(`BTC upstream failure: ${e1.message} / ${e2.message}`);
    }
  }
}

async function fetchBTCTicker() {
  try {
    const url = `https://api.binance.com/api/v3/ticker/bookTicker?symbol=BTCUSDT`;
    const t = await fetchJSON(url);
    const bid = +t.bidPrice, ask = +t.askPrice;
    return {
      source: 'binance',
      bid, ask,
      price: (bid + ask) / 2,
      spread: ask - bid,
      ts: Date.now()
    };
  } catch (e1) {
    try {
      const url = `https://api.kraken.com/0/public/Ticker?pair=XBTUSD`;
      const t = await fetchJSON(url);
      const k = Object.keys(t.result)[0];
      const bid = +t.result[k].b[0], ask = +t.result[k].a[0];
      return { source: 'kraken', bid, ask, price:(bid+ask)/2, spread: ask-bid, ts: Date.now() };
    } catch (e2) {
      throw new Error(`BTC ticker failure: ${e1.message} / ${e2.message}`);
    }
  }
}

// --- XAU -----------------------------------------------------------------

async function fetchXAUCandles(interval, limit) {
  // Fuente primaria: Yahoo Finance (Gold Futures GC=F)
  try {
    const range = YAHOO_RANGE[interval] || '1d';
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${interval}&range=${range}`;
    const data = await fetchJSON(url, { headers: YAHOO_HEADERS });
    const result = data.chart?.result?.[0];
    if (!result) throw new Error('Yahoo empty response');
    const ts = result.timestamp || [];
    const q  = result.indicators.quote[0];
    const candles = ts.map((t, i) => ({
      time:  t * 1000,
      open:  q.open[i],
      high:  q.high[i],
      low:   q.low[i],
      close: q.close[i],
      volume:q.volume[i] || 0
    })).filter(c => c.open != null && c.close != null);
    if (candles.length < 5) throw new Error('Yahoo insufficient data');
    return { source: 'yahoo', candles: candles.slice(-limit) };
  } catch (e1) {
    // Fuente respaldo: Stooq (retornos diarios/horarios)
    try {
      const stooqInterval = ['1m','5m','15m','30m','1h'].includes(interval) ? '5' : 'd';
      const url = `https://stooq.com/q/d/l/?s=xauusd&i=${stooqInterval}`;
      const r = await fetch(url, { headers: YAHOO_HEADERS });
      if (!r.ok) throw new Error(`Stooq HTTP ${r.status}`);
      const text = await r.text();
      const lines = text.trim().split('\n').slice(1);
      const candles = lines.slice(-limit).map(line => {
        const [date, o, h, l, c, v] = line.split(',');
        return {
          time: new Date(date).getTime(),
          open: +o, high: +h, low: +l, close: +c, volume: +v || 0
        };
      }).filter(c => !isNaN(c.close));
      return { source: 'stooq', candles };
    } catch (e2) {
      throw new Error(`XAU upstream failure: ${e1.message} / ${e2.message}`);
    }
  }
}

async function fetchXAUTicker() {
  try {
    const data = await fetchJSON('https://api.gold-api.com/price/XAU');
    const price = data.price;
    if (!price) throw new Error('Gold-API empty');
    const spread = 0.35;
    return { source: 'gold-api', bid: price - spread/2, ask: price + spread/2, price, spread, ts: Date.now() };
  } catch (e1) {
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d`;
      const data = await fetchJSON(url, { headers: YAHOO_HEADERS });
      const price = data.chart?.result?.[0]?.meta?.regularMarketPrice;
      if (!price) throw new Error('Yahoo meta empty');
      return { source: 'yahoo', bid: price - 0.18, ask: price + 0.18, price, spread: 0.35, ts: Date.now() };
    } catch (e2) {
      throw new Error(`XAU ticker failure: ${e1.message} / ${e2.message}`);
    }
  }
}

// --- Handler -------------------------------------------------------------

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const asset    = (req.query.asset || 'BTC').toUpperCase();
  const mode     = req.query.mode || 'candles';
  const interval = normalizeInterval(req.query.interval || '1m');
  const limit    = clampLimit(req.query.limit || 250);

  try {
    let payload;
    if (mode === 'ticker') {
      if (asset === 'BTC') payload = await fetchBTCTicker();
      else if (asset === 'XAU') payload = await fetchXAUTicker();
      else throw new Error('Asset not supported');
      // ticker cache muy corta
      res.setHeader('Cache-Control', 's-maxage=1, stale-while-revalidate=2');
    } else {
      let result;
      if (asset === 'BTC') result = await fetchBTCCandles(interval, limit);
      else if (asset === 'XAU') result = await fetchXAUCandles(interval, limit);
      else throw new Error('Asset not supported');
      payload = { ...result, interval, count: result.candles.length };
      res.setHeader('Cache-Control', 's-maxage=3, stale-while-revalidate=10');
    }
    return res.status(200).json({ ok: true, asset, mode, ...payload });
  } catch (e) {
    return res.status(502).json({
      ok: false,
      asset,
      mode,
      error: e.message || String(e),
      ts: Date.now()
    });
  }
}
