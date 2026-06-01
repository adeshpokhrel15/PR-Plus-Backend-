const axios = require('axios');
const config = require('../config');
const logger = require('./logger');

// Shared axios instance with timeouts and browser-like headers
const httpClient = axios.create({
  timeout: config.scraper.timeout,
  headers: {
    'User-Agent':      config.scraper.userAgent,
    'Accept':          'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-AU,en;q=0.9',
    'Accept-Encoding': 'gzip, deflate, br',
    'Cache-Control':   'no-cache',
    'Connection':      'keep-alive',
  },
  maxRedirects: 5,
});

// Polite delay helper
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Fetch with retry
async function fetchWithRetry(url, options = {}, attempt = 1) {
  try {
    logger.debug(`Fetching: ${url} (attempt ${attempt})`);
    const response = await httpClient.get(url, options);
    return response;
  } catch (err) {
    const status = err.response?.status;
    logger.warn(`Fetch failed: ${url}`, { status, attempt, message: err.message });

    if (attempt < config.scraper.retries && status !== 404 && status !== 403) {
      const backoff = config.scraper.delay * attempt;
      logger.debug(`Retrying in ${backoff}ms…`);
      await sleep(backoff);
      return fetchWithRetry(url, options, attempt + 1);
    }
    throw err;
  }
}

// Fetch HTML string
async function fetchHtml(url, options = {}) {
  const res = await fetchWithRetry(url, { ...options, responseType: 'text' });
  return res.data;
}

// Fetch JSON
async function fetchJson(url, options = {}) {
  const res = await fetchWithRetry(url, { ...options, responseType: 'json' });
  return res.data;
}

// Fetch binary (for PDFs)
async function fetchBuffer(url) {
  const res = await fetchWithRetry(url, { responseType: 'arraybuffer' });
  return Buffer.from(res.data);
}

module.exports = { fetchHtml, fetchJson, fetchBuffer, sleep };
