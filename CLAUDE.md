# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Buddhist scripture reading tracker (大藏经诵读认领系统) for claiming and managing Tripitaka reading volumes. Full-stack React + Express application with optional Supabase persistence and AI-generated blessings.

## Development Commands

### Prerequisites
- Node.js installed
- Create `.env` with required variables (see Environment Variables section)

### Essential Commands
```bash
npm install              # Install dependencies
npm run dev             # Start Vite dev server on port 3000
npm run build           # Build for production (output: dist/)
npm run preview         # Preview production build
npm start               # Start Express backend server on port 3001
```

### Running the Full Application
Both frontend and backend must run simultaneously:
1. Terminal 1: `npm run dev` (frontend at http://localhost:3000)
2. Terminal 2: `npm start` (backend at http://localhost:3001)

### No Tests or Linting
There are no test files, test frameworks, ESLint, or Prettier configured in this project.

## Architecture Overview

### Frontend (React 19 SPA)
- **Single Component Design**: All UI logic lives in [App.tsx](App.tsx) (~654 lines)
- **Four View States** (`AppView` type): `home` (volume list), `claim` (form), `success` (confirmation), `scripture` (reading view)
- **No Router**: View switching via `useState` (`view` variable)
- **Mobile-Responsive**: Card layout on mobile, table on desktop

### Data Layer ([dbService.ts](dbService.ts))
Hybrid persistence strategy:
1. **Primary Storage**: Browser LocalStorage (key: `longzang_tripitaka_volumes_v13`)
2. **Optional Sync**: Supabase via backend API
3. **Data Flow**:
   - On load: Fetch from `/api/claims` (10s timeout) → merge with LocalStorage → update UI
   - On claim: Save to both LocalStorage and Supabase (via backend)
   - Auto-completion: Client-side date comparison marks volumes as `COMPLETED`

### Backend ([server.js](server.js))
Express 5 server (~833 lines) with caching (1-minute for claims, 1-hour for scripture):

| Endpoint | Description |
|----------|-------------|
| `POST /api/claim` | Validate + save claim to Supabase |
| `GET /api/claims` | Fetch all claims (cached, `?fresh=1` to bypass) |
| `GET /api/scripture/:scroll` | Fetch scripture HTML from xianmijingzang.com (GBK→UTF-8) |
| `GET /api/scripture/:scroll/txt` | Download scripture as plain text |
| `GET /api/scripture/:scroll/pdf` | Generate PDF via Puppeteer with ruby annotations |
| `GET /view?code=ACCESS_CODE` | Admin dashboard HTML (password-protected) |
| `GET /view.csv?code=ACCESS_CODE` | CSV export of all claims (password-protected) |

The backend fails gracefully if Supabase credentials are not configured. Claims still save to LocalStorage.

### Data Structure ([types.ts](types.ts), [data.ts](data.ts))
- `Volume`: Scripture volume with status (unclaimed/claimed/completed), claimer info, dates
- `createSutraVolumes()`: Generates 200 Prajna section volumes (大般若波羅蜜多經, scrolls 1-200)
- Reading URLs point to xianmijingzang.com (collection ID 43, subid 67)

### AI Integration ([geminiService.ts](geminiService.ts))
**Currently Disabled**: The `@google/genai` import is commented out and replaced with a mock object to avoid Vite build errors. Returns hardcoded fallback blessing messages.

## Environment Variables

```bash
# Frontend (accessed via import.meta.env)
VITE_GEMINI_API_KEY=...        # Google Gemini API key (optional, AI disabled by default)
VITE_API_URL=...               # Backend API base URL

# Backend (accessed via process.env)
SUPABASE_URL=...               # Supabase endpoint (optional)
SUPABASE_ANON_KEY=...          # Supabase auth token (optional)
VIEW_ACCESS_CODE=...           # Password for /view admin dashboard (default: 'admin123')
```

## Key Implementation Patterns

### Volume Claiming Flow
1. User clicks "我要认领" → sets `selectedVolume`, switches to `claim` view
2. User submits form → `handleSubmit` POSTs to `/api/claim`
3. Backend validates (name, 8-11 digit phone), checks for duplicate volumeId, saves to Supabase
4. Frontend updates LocalStorage via `dbService.claimVolume()`
6. Switch to `success` view with blessing message and completion date

### Status Management
Volumes have three states (defined in [types.ts](types.ts)):
- `UNCLAIMED`: Available for claiming
- `CLAIMED`: Active claim, deadline not yet passed
- `COMPLETED`: Deadline passed (auto-marked in `dbService.getVolumes()`)

### Phone Number Validation
Backend enforces 8-11 digit phone numbers. Duplicate claims for the same volumeId return 409.

## Supabase Integration

The `claims` table uses these columns:
```
volumeId | volumeNumber | volumeTitle | name | phone | plannedDays | readingUrl | claimedAt | expectedCompletionDate | remarks | status
```

## Styling

- Tailwind CSS via CDN (in [index.html](index.html))
- Custom CSS variables in [styles.css](styles.css): `--sutra-brown`, `--sutra-gold`, `--sutra-bg`, `--sutra-border`
- Chinese fonts: Noto Serif SC (`.serif-title`), Ma Shan Zheng (`.calligraphy`)
- Animations: `fade-in` class with staggered delays

## Path Aliasing

TypeScript and Vite both configured with `@/*` → project root:
```typescript
import { dbService } from '@/dbService'
```

## Known Issues & Notes

1. **Gemini Service Disabled**: AI import is stubbed out with mock object in [geminiService.ts](geminiService.ts)
2. **LocalStorage-First Design**: App works completely offline; Supabase is optional
3. **No Authentication**: Anyone can claim any volume
4. **Puppeteer Required**: PDF generation endpoint requires Puppeteer (heavy dependency)
5. **External Scripture Source**: Scripture content proxied from xianmijingzang.com with GBK→UTF-8 decoding
