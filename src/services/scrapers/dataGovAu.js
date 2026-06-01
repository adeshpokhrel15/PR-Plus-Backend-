/**
 * data.gov.au CKAN API Integration
 * Official Australian Government Open Data Portal
 * API Docs: https://data.gov.au/data/api/3/
 * No API key required — public data
 */
const { fetchJson } = require('../../utils/httpClient');
const { getDb, dbHelpers } = require('../../config/database');
const logger = require('../../utils/logger');
const config = require('../../config');

const BASE = config.dataGovAu.base; // https://data.gov.au/api/3/action

// ── Known migration dataset IDs on data.gov.au ───────────────────
const DATASET_IDS = {
  // These are real dataset identifiers from data.gov.au
  migrationStats:     'migration-programme-report',
  populationStats:    'national-regional-and-city-population',
  workforceSkills:    'skills-shortage-lists',
  labourMarket:       'labour-market-information',
};

// ── Search for migration-related datasets ─────────────────────────
async function searchMigrationDatasets() {
  const cacheKey = 'datagov_datasets';
  const cached = dbHelpers.cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchJson(`${BASE}/package_search`, {
      params: { q: 'skilled migration visa immigration', rows: 20, sort: 'metadata_modified desc' }
    });

    if (!res.success || !res.result?.results) throw new Error('Unexpected API response');

    const datasets = res.result.results.map(pkg => ({
      id:           pkg.id,
      name:         pkg.name,
      title:        pkg.title,
      notes:        pkg.notes?.slice(0, 300),
      url:          `https://data.gov.au/dataset/${pkg.name}`,
      organization: pkg.organization?.title,
      modified:     pkg.metadata_modified,
      resources:    pkg.resources?.map(r => ({
        id:     r.id,
        name:   r.name,
        format: r.format,
        url:    r.url,
        size:   r.size,
      })) || [],
    }));

    dbHelpers.cacheSet(cacheKey, datasets, 3600 * 6); // 6 hour cache
    logger.info(`[DataGovAu] Found ${datasets.length} migration datasets`);
    return datasets;
  } catch (err) {
    logger.error('[DataGovAu] Dataset search failed', { error: err.message });
    return [];
  }
}

// ── Fetch a specific dataset's resources ─────────────────────────
async function getDatasetResources(datasetName) {
  const cacheKey = `datagov_pkg_${datasetName}`;
  const cached = dbHelpers.cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchJson(`${BASE}/package_show`, { params: { id: datasetName } });
    if (!res.success) throw new Error('Package not found');

    const pkg = res.result;
    const result = {
      title:       pkg.title,
      description: pkg.notes,
      url:         `https://data.gov.au/dataset/${pkg.name}`,
      modified:    pkg.metadata_modified,
      resources:   pkg.resources || [],
    };

    dbHelpers.cacheSet(cacheKey, result, 3600 * 12);
    return result;
  } catch (err) {
    logger.error('[DataGovAu] Package fetch failed', { datasetName, error: err.message });
    return null;
  }
}

// ── Fetch CSV resource and parse it ──────────────────────────────
async function fetchCsvResource(resourceUrl) {
  try {
    const { fetchHtml } = require('../../utils/httpClient');
    const csv = await fetchHtml(resourceUrl);

    // Simple CSV parser
    const lines = csv.trim().split('\n');
    const headers = lines[0].split(',').map(h => h.replace(/"/g, '').trim());
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.replace(/"/g, '').trim());
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] || '']));
    });

    return { headers, rows };
  } catch (err) {
    logger.error('[DataGovAu] CSV fetch failed', { url: resourceUrl, error: err.message });
    return null;
  }
}

// ── Fetch migration program statistics ────────────────────────────
async function getMigrationProgramStats() {
  const cacheKey = 'migration_program_stats';
  const cached = dbHelpers.cacheGet(cacheKey);
  if (cached) return cached;

  try {
    // Try to get the migration programme report dataset
    const dataset = await getDatasetResources(DATASET_IDS.migrationStats);
    if (!dataset) throw new Error('Dataset not available');

    // Find the most recent CSV or XLS
    const csvResource = dataset.resources.find(r =>
      r.format?.toLowerCase().includes('csv') || r.url?.endsWith('.csv')
    );

    if (csvResource) {
      const data = await fetchCsvResource(csvResource.url);
      dbHelpers.cacheSet(cacheKey, data, 3600 * 24);
      return data;
    }

    return { headers: [], rows: [], source: dataset.url };
  } catch (err) {
    logger.warn('[DataGovAu] Migration stats unavailable', { error: err.message });
    return null;
  }
}

// ── Fetch real-time package activity ─────────────────────────────
async function getRecentDataUpdates() {
  const cacheKey = 'datagov_recent';
  const cached = dbHelpers.cacheGet(cacheKey);
  if (cached) return cached;

  try {
    const res = await fetchJson(`${BASE}/recently_changed_packages_activity_list`, {
      params: { limit: 5 }
    });

    const activity = (res.result || []).map(a => ({
      type:     a.activity_type,
      dataset:  a.data?.package?.title,
      time:     a.timestamp,
    })).filter(a => a.dataset);

    dbHelpers.cacheSet(cacheKey, activity, 3600);
    return activity;
  } catch (err) {
    return [];
  }
}

module.exports = {
  searchMigrationDatasets,
  getDatasetResources,
  getMigrationProgramStats,
  getRecentDataUpdates,
};
