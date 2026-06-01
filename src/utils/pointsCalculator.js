/**
 * Official Australian Points-Based Migration Calculator
 * Based on: https://immi.homeaffairs.gov.au/help-support/tools/points-calculator
 * Subclass 189, 190, 491
 */

// ── Official Points Tables (current as of 2024) ───────────────────
const POINTS_TABLE = {
  age: {
    label: 'Age at time of invitation',
    options: [
      { label: '18–24 years', points: 25 },
      { label: '25–32 years', points: 30 },
      { label: '33–39 years', points: 25 },
      { label: '40–44 years', points: 15 },
      { label: '45–49 years', points: 0  },
    ],
  },
  english: {
    label: 'English language ability',
    options: [
      { label: 'Competent (IELTS 6.0 / PTE 50 / TOEFL 60)',    points: 0  },
      { label: 'Proficient (IELTS 7.0 / PTE 65 / TOEFL 94)',   points: 10 },
      { label: 'Superior (IELTS 8.0+ / PTE 79+ / TOEFL 104+)', points: 20 },
    ],
  },
  education: {
    label: 'Educational qualifications',
    options: [
      { label: 'Doctorate from Australian institution',                    points: 20 },
      { label: 'PhD or other Doctorate degree',                           points: 20 },
      { label: 'Bachelor Degree or higher / Masters by coursework',       points: 15 },
      { label: 'Diploma or Trade qualification',                          points: 10 },
      { label: 'Award from Australian institution (min. 2 yrs)',          points: 5  },
    ],
  },
  workExperience: {
    label: 'Skilled employment (overseas or in Australia)',
    options: [
      { label: 'Less than 3 years',  points: 0  },
      { label: '3–4 years',          points: 5  },
      { label: '5–7 years',          points: 10 },
      { label: '8–10 years',         points: 15 },
      { label: '10 or more years',   points: 20 },
    ],
  },
  australianWork: {
    label: 'Australian skilled employment in last 10 years',
    options: [
      { label: 'None',           points: 0  },
      { label: '1–2 years',     points: 5  },
      { label: '3–4 years',     points: 10 },
      { label: '5 or more years', points: 15 },
    ],
  },
  partnerSkills: {
    label: 'Partner/spouse skills',
    options: [
      { label: 'Single / No partner accompanying',         points: 10 },
      { label: 'Partner with Competent English & skills',  points: 5  },
      { label: 'Partner is Australian citizen or PR',      points: 10 },
    ],
  },
  australianStudy: {
    label: 'Australian study requirement (2+ years in Australia)',
    options: [
      { label: 'No',                                    points: 0 },
      { label: 'Yes – at least 2 years regional study', points: 5 },
      { label: 'Yes – at least 2 years metro study',    points: 5 },
    ],
  },
  specialistEducation: {
    label: 'Specialist education qualification (STEM / select fields)',
    options: [
      { label: 'No',  points: 0  },
      { label: 'Yes', points: 10 },
    ],
  },
  nomination: {
    label: 'State/territory nomination',
    options: [
      { label: 'No nomination',                           points: 0  },
      { label: 'Subclass 190 – state/territory nominated', points: 5  },
      { label: 'Subclass 491 – regional nominated',        points: 15 },
    ],
  },
};

// ── Current competitive cutoff points (updated periodically) ──────
const COMPETITIVE_CUTOFFS = {
  '189': { current: 90, min: 65, note: 'Stable at 90 for past 10 rounds (as of Jun 2024)' },
  '190': { current: 80, min: 65, note: '+5 pts from nomination. Effective: 75 base' },
  '491': { current: 75, min: 65, note: '+15 pts from nomination. Effective: 60 base' },
};

// ── Visa eligibility checker ──────────────────────────────────────
function checkEligibility(profile) {
  const basePts = calculateTotal(profile);
  const result = {};

  for (const [visa, cutoff] of Object.entries(COMPETITIVE_CUTOFFS)) {
    const bonus = visa === '190' ? 5 : visa === '491' ? 15 : 0;
    const effective = basePts + (profile.nomination?.includes(visa) ? bonus : 0);
    result[visa] = {
      basePts,
      effectivePts:    effective,
      competitiveCutoff: cutoff.current,
      minimumRequired:   cutoff.min,
      isAboveMinimum:    effective >= cutoff.min,
      isCompetitive:     effective >= cutoff.current,
      pointsNeeded:      Math.max(0, cutoff.current - effective),
      note:              cutoff.note,
    };
  }

  return result;
}

// ── Total calculator ──────────────────────────────────────────────
function calculateTotal(profile) {
  let total = 0;
  for (const [key, table] of Object.entries(POINTS_TABLE)) {
    const profileVal = profile[key];
    if (!profileVal) continue;
    const match = table.options.find(o =>
      o.label === profileVal ||
      o.label.toLowerCase().startsWith(profileVal.toLowerCase())
    );
    if (match) total += match.points;
  }
  return Math.min(total, 120); // max 120 pts
}

// ── Breakdown by factor ───────────────────────────────────────────
function getBreakdown(profile) {
  return Object.entries(POINTS_TABLE).map(([key, table]) => {
    const profileVal = profile[key];
    const match = profileVal ? table.options.find(o =>
      o.label === profileVal || o.label.toLowerCase().startsWith(profileVal.toLowerCase())
    ) : null;
    return {
      key,
      label:     table.label,
      selection: profileVal || null,
      points:    match ? match.points : 0,
      maxPoints: Math.max(...table.options.map(o => o.points)),
      options:   table.options,
    };
  });
}

// ── Boost recommendations ─────────────────────────────────────────
function getRecommendations(profile, targetPts = 90) {
  const current = calculateTotal(profile);
  const gap = Math.max(0, targetPts - current);
  const recs = [];

  for (const [key, table] of Object.entries(POINTS_TABLE)) {
    const profileVal = profile[key];
    const currentMatch = profileVal
      ? table.options.find(o => o.label === profileVal || o.label.toLowerCase().startsWith(profileVal.toLowerCase()))
      : null;
    const currentPts = currentMatch?.points || 0;
    const bestOpt = table.options.reduce((a, b) => b.points > a.points ? b : a);
    const nextOpt = table.options.find(o => o.points > currentPts);

    if (nextOpt && nextOpt.points > currentPts) {
      recs.push({
        factor:     key,
        label:      table.label,
        current:    profileVal || 'Not set',
        currentPts,
        nextTarget: nextOpt.label,
        nextPts:    nextOpt.points,
        gain:       nextOpt.points - currentPts,
        maxGain:    bestOpt.points - currentPts,
      });
    }
  }

  return recs
    .sort((a, b) => b.gain - a.gain)
    .map((r, i) => ({ ...r, priority: i + 1 }));
}

module.exports = {
  POINTS_TABLE,
  COMPETITIVE_CUTOFFS,
  calculateTotal,
  checkEligibility,
  getBreakdown,
  getRecommendations,
};
