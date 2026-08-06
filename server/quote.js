'use strict';

const configRepo = require('./repo/config.repo.js');

const CACHE_MS = 5 * 60 * 1000;
let cache = { data: null, at: 0 };

function fetchTimeout(url, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms || 8000);
  return fetch(url, { signal: ctrl.signal }).then(
    (r) => { clearTimeout(t); if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); },
    (e) => { clearTimeout(t); throw e; }
  );
}

async function fetchLive() {
  try {
    const d = await fetchTimeout('https://economia.awesomeapi.com.br/last/USD-BRL,GBP-BRL,EUR-BRL');
    if (!d.USDBRL) throw new Error('resposta inesperada da AwesomeAPI');
    return {
      usd: parseFloat(d.USDBRL.bid),
      gbp: d.GBPBRL ? parseFloat(d.GBPBRL.bid) : 0,
      eur: d.EURBRL ? parseFloat(d.EURBRL.bid) : 0,
      usdVar: parseFloat(d.USDBRL.pctChange) || 0,
      gbpVar: d.GBPBRL ? (parseFloat(d.GBPBRL.pctChange) || 0) : 0,
      eurVar: d.EURBRL ? (parseFloat(d.EURBRL.pctChange) || 0) : 0,
      at: new Date().toISOString(),
      source: 'AwesomeAPI'
    };
  } catch {
    const d = await fetchTimeout('https://open.er-api.com/v6/latest/USD');
    if (!d.rates || !d.rates.BRL) throw new Error('resposta inesperada da exchangerate-api');
    return {
      usd: d.rates.BRL,
      gbp: d.rates.GBP ? d.rates.BRL / d.rates.GBP : 0,
      eur: d.rates.EUR ? d.rates.BRL / d.rates.EUR : 0,
      usdVar: 0,
      gbpVar: 0,
      eurVar: 0,
      at: new Date().toISOString(),
      source: 'exchangerate-api'
    };
  }
}

async function getQuote(force) {
  const fresh = cache.data && (Date.now() - cache.at) < CACHE_MS;
  if (fresh && !force) return cache.data;
  try {
    const data = await fetchLive();
    cache = { data, at: Date.now() };

    try { await configRepo.syncAutoRates(data.usd, data.eur, data.gbp); } catch (err) {
      console.error('Falha ao aplicar cotacao automatica:', err.message);
    }
    return data;
  } catch (err) {
    if (cache.data) return cache.data; 
    throw err;
  }
}

function startAutoSync(intervalMs) {
  getQuote(false).catch(() => {});
  const timer = setInterval(() => { getQuote(true).catch(() => {}); }, intervalMs || 10 * 60 * 1000);
  timer.unref();
  return timer;
}

module.exports = { getQuote, startAutoSync };
