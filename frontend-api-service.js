/**
 * PR Plus — Frontend API Service
 * Drop this into your React project at src/services/api.js
 * Update VITE_API_URL in .env to point at your backend
 */

const BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

async function req(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...options.headers },
    ...options,
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Points & Eligibility ──────────────────────────────────────────
export const pointsApi = {
  /** Fetch the official DHA points table */
  getTable:     ()        => req('/points/table'),
  /** Calculate points + eligibility from a profile object */
  calculate:    (profile) => req('/points/calculate', { method: 'POST', body: JSON.stringify(profile) }),
};

// ── Invitation Rounds ─────────────────────────────────────────────
export const invitationsApi = {
  /** Get paginated invitation rounds. visa: '189'|'190'|'491' */
  getRounds:    (params = {}) => req(`/invitations?${new URLSearchParams(params)}`),
  /** Get trend data pivoted by date (for recharts) */
  getTrends:    ()            => req('/invitations/trends'),
  /** Trigger a live rescrape */
  refresh:      ()            => req('/invitations/refresh', { method: 'POST' }),
};

// ── State Nominations ─────────────────────────────────────────────
export const statesApi = {
  /** All 8 states/territories with live status */
  getAll:       ()      => req('/states'),
  /** Single state by code e.g. 'NSW' */
  getState:     (code)  => req(`/states/${code}`),
  /** Trigger a live rescrape of all state pages */
  refresh:      ()      => req('/states/refresh', { method: 'POST' }),
};

// ── Occupations ───────────────────────────────────────────────────
export const occupationsApi = {
  /** Search occupations. params: { search, demand, stream, limit, page } */
  search:       (params = {}) => req(`/occupations?${new URLSearchParams(params)}`),
  /** Get occupation by ANZSCO code e.g. '261313' */
  getByCode:    (code)        => req(`/occupations/${code}`),
};

// ── News ──────────────────────────────────────────────────────────
export const newsApi = {
  /** Get news. params: { state, topic, limit, page } */
  getNews:      (params = {}) => req(`/news?${new URLSearchParams(params)}`),
};

// ── Open Government Data ──────────────────────────────────────────
export const openDataApi = {
  /** Search data.gov.au migration datasets */
  getDatasets:  ()  => req('/opendata/datasets'),
  /** Fetch migration program statistics */
  getStats:     ()  => req('/opendata/stats'),
};

// ── User Profiles ─────────────────────────────────────────────────
export const profilesApi = {
  create:       (data)          => req('/profiles', { method: 'POST', body: JSON.stringify(data) }),
  get:          (id)            => req(`/profiles/${id}`),
  update:       (id, data)      => req(`/profiles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// ── EOI Tracker ───────────────────────────────────────────────────
export const eoiApi = {
  getAll:       (profileId)     => req(`/eoi/${profileId}`),
  create:       (data)          => req('/eoi', { method: 'POST', body: JSON.stringify(data) }),
  update:       (id, data)      => req(`/eoi/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete:       (id)            => req(`/eoi/${id}`, { method: 'DELETE' }),
};

// ── Visa Fees ─────────────────────────────────────────────────────
export const feesApi = {
  getFees:      ()              => req('/visa-fees'),
};

// ── Health ────────────────────────────────────────────────────────
export const healthApi = {
  check:        ()              => req('/health'),
};

// ── Default export (all APIs bundled) ────────────────────────────
export default {
  points:      pointsApi,
  invitations: invitationsApi,
  states:      statesApi,
  occupations: occupationsApi,
  news:        newsApi,
  openData:    openDataApi,
  profiles:    profilesApi,
  eoi:         eoiApi,
  fees:        feesApi,
  health:      healthApi,
};
