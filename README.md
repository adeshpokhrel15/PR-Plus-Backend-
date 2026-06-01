# PR Plus Backend — Australian Immigration Data API

Node.js + Express backend that serves real data from official Australian government sources.

---

## 🏗 Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        PR Plus Backend                          │
│                                                                 │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌───────────────┐  │
│  │ Express  │  │  Cron    │  │  Cache   │  │   SQLite DB   │  │
│  │  API     │  │  Jobs    │  │  Layer   │  │  (persistent) │  │
│  │          │  │ (6 jobs) │  │ L1+L2    │  │               │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬───────┘  │
│       │              │              │                │          │
│  ┌────▼──────────────▼──────────────▼────────────────▼──────┐  │
│  │                   Data Service Layer                       │  │
│  └───────────┬───────────────────────┬─────────────────────┘  │
│              │                       │                         │
│  ┌───────────▼──────┐  ┌────────────▼──────────────────────┐  │
│  │  DHA Scraper     │  │  State Nomination Scrapers (x8)    │  │
│  │  homeaffairs.gov │  │  NSW/VIC/QLD/WA/SA/TAS/ACT/NT     │  │
│  └──────────────────┘  └───────────────────────────────────┘  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  data.gov.au CKAN API (official open government data)      │  │
│  └────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 🚀 Quick Start

```bash
# 1. Clone and install
git clone https://github.com/your-org/prplus-backend
cd prplus-backend
npm install

# 2. Configure
cp .env.example .env
# Edit .env — at minimum set FRONTEND_URL

# 3. Seed the database
npm run seed

# 4. Start
npm run dev     # development (nodemon)
npm start       # production
```

---

## 📡 API Reference

Base URL: `http://localhost:4000/api/v1`

### Health
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/health` | Server health, job status, cache stats |

### Points & Eligibility
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/points/table` | Official points table with all factors |
| POST   | `/points/calculate` | Calculate points + eligibility for 189/190/491 |

**POST /points/calculate — Request body:**
```json
{
  "age": "25–32 years",
  "english": "Superior (IELTS 8.0+ / PTE 79+ / TOEFL 104+)",
  "education": "Bachelor Degree or higher / Masters by coursework",
  "workExperience": "5–7 years",
  "australianWork": "1–2 years",
  "partnerSkills": "Single / No partner accompanying",
  "australianStudy": "No",
  "specialistEducation": "No",
  "nomination": "No nomination"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "total": 85,
    "breakdown": [...],
    "eligibility": {
      "189": { "effectivePts": 85, "competitiveCutoff": 90, "isCompetitive": false, "pointsNeeded": 5 },
      "190": { "effectivePts": 90, "isCompetitive": true },
      "491": { "effectivePts": 100, "isCompetitive": true }
    },
    "recommendations": [
      { "factor": "english", "gain": 10, "nextTarget": "Superior (IELTS 8.0+)", "priority": 1 }
    ]
  }
}
```

### Invitation Rounds
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/invitations?visa=189&limit=24` | Scrape + return invitation rounds |
| GET    | `/invitations/trends` | Pivoted trend data for charts |
| POST   | `/invitations/refresh` | Manually trigger rescrape |

### State Nominations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/states` | All 8 states/territories |
| GET    | `/states/NSW` | Single state |
| POST   | `/states/refresh` | Trigger fresh scrape |

### Occupations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/occupations?search=nurse&demand=Critical` | Search occupations |
| GET    | `/occupations/234611` | Single occupation by ANZSCO code |

### News
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/news?state=Queensland&topic=Occupation+List&limit=20` | Migration news |

### Open Government Data
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/opendata/datasets` | Search data.gov.au for migration datasets |
| GET    | `/opendata/stats` | Fetch migration program statistics |

### User Profiles & EOI
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST   | `/profiles` | Create profile |
| GET    | `/profiles/:id` | Get profile |
| PUT    | `/profiles/:id` | Update profile |
| GET    | `/eoi/:profileId` | Get all EOI entries for profile |
| POST   | `/eoi` | Create EOI entry |
| PUT    | `/eoi/:id` | Update EOI status |
| DELETE | `/eoi/:id` | Delete EOI entry |

### Visa Fees
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET    | `/visa-fees` | Current DHA visa fees (static, updated manually) |

---

## 🔄 Data Refresh Schedule

| Data | Frequency | Source |
|------|-----------|--------|
| Invitation Rounds | Every 6 hours | homeaffairs.gov.au |
| State Nominations | Every 2 hours | State government websites |
| Migration News | Every 1 hour | homeaffairs.gov.au |
| Occupation Lists | Daily at 3am | homeaffairs.gov.au |
| data.gov.au datasets | Every 6 hours | data.gov.au CKAN API |

---

## ⚠️ Important Notes

### Official API availability
The Australian Department of Home Affairs **does not provide a public REST API**.
Data is obtained by:
1. Web scraping official government pages (respectfully, with delays)
2. data.gov.au CKAN API (official open data portal — no key required)
3. Static data files updated from official publications

### Scraping ethics
- Requests use a delay of 2 seconds between calls
- Custom User-Agent identifies the bot
- Respects server response codes (429, 503 → back off)
- Caches aggressively to minimise repeat requests
- Falls back to last known data if scraping fails

### Data accuracy
All data should be verified against official sources:
- homeaffairs.gov.au
- Individual state migration authority websites
- data.gov.au

---

## 🔧 Connecting to the Frontend

In your React frontend, update `src/services/api.js`:
```javascript
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:4000/api/v1';

export const api = {
  getInvitationRounds: () => fetch(`${API_BASE}/invitations/trends`).then(r => r.json()),
  getStates:           () => fetch(`${API_BASE}/states`).then(r => r.json()),
  calculatePoints:     (profile) => fetch(`${API_BASE}/points/calculate`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(profile)
  }).then(r => r.json()),
  getNews:             (params) => fetch(`${API_BASE}/news?${new URLSearchParams(params)}`).then(r => r.json()),
  getOccupations:      (params) => fetch(`${API_BASE}/occupations?${new URLSearchParams(params)}`).then(r => r.json()),
  getVisaFees:         () => fetch(`${API_BASE}/visa-fees`).then(r => r.json()),
};
```
"# PR-Plus-Backend-" 
