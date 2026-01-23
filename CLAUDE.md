# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A Buddhist scripture reading tracker (大藏经诵读认领系统) for claiming and managing Tripitaka reading volumes. Built as a full-stack React application with optional Google Sheets persistence and AI-generated blessings.

## Development Commands

### Prerequisites
- Node.js installed
- Copy `.env_example` to `.env` and configure API keys

### Essential Commands
```bash
npm install              # Install dependencies
npm run dev             # Start Vite dev server on port 3000
npm run build           # Build for production (output: dist/)
npm run preview         # Preview production build
npm start               # Start Express backend server on port 3001
```

### Running the Full Application
The app requires both frontend and backend running:
1. Terminal 1: `npm run dev` (frontend at http://localhost:3000)
2. Terminal 2: `npm start` (backend at http://localhost:3001)

## Architecture Overview

### Frontend Architecture (React SPA)
- **Single Component Design**: All UI logic lives in [App.tsx](App.tsx)
- **Three View States**: `home` (volume list), `claim` (form), `success` (confirmation)
- **Client-Side State Management**: Uses React `useState` for all state
- **No Router**: View switching via state (`view` variable)

### Data Layer ([dbService.ts](dbService.ts))
Hybrid persistence strategy:
1. **Primary Storage**: Browser LocalStorage (key: `longzang_tripitaka_volumes_v12`)
2. **Optional Sync**: Google Sheets via SheetDB API
3. **Data Flow**:
   - On load: Fetch from SheetDB → Merge with LocalStorage → Update UI
   - On claim: Save to both LocalStorage and SheetDB (via backend)
   - Auto-completion: Client-side date comparison marks volumes as completed

### Backend ([server.js](server.js))
Express server with two endpoints:
- `POST /api/claim`: Accepts claim data, saves to SheetDB (if configured), returns success
- `GET /api/claims`: Fetches all claims from SheetDB

**Important**: The backend fails gracefully if SheetDB credentials are not configured. Claims still save to LocalStorage.

### Data Structure ([types.ts](types.ts), [data.ts](data.ts))
- **Volume**: Represents a scripture volume with status (unclaimed/claimed/completed)
- **INITIAL_VOLUMES**: Hardcoded list of 700+ Prajna section volumes
- **Volume Generation**: Helper function `createSutraVolumes()` generates volumes from metadata

### AI Integration ([geminiService.ts](geminiService.ts))
**Currently Disabled**: The Gemini API integration is stubbed out with a mock object. To enable:
1. Uncomment the real import
2. Initialize with `GEMINI_API_KEY` from environment
3. Used for generating Buddhist blessing messages after successful claims

## Environment Variables

Required in `.env`:
```bash
VITE_GEMINI_API_KEY=...        # Google Gemini API key (optional if AI disabled)
SHEETDB_API_URL=...            # SheetDB endpoint (optional)
SHEETDB_API_KEY=...            # SheetDB auth token (optional)
```

Frontend access: `import.meta.env.VITE_GEMINI_API_KEY`
Backend access: `process.env.SHEETDB_API_URL`

## Key Implementation Patterns

### Volume Claiming Flow
1. User clicks "我要认领" → Sets `selectedVolume` and switches to `claim` view
2. User submits form → `handleSubmit` calls backend `/api/claim`
3. Backend attempts SheetDB save (fails gracefully if not configured)
4. Frontend updates LocalStorage via `dbService.claimVolume()`
5. Generate blessing message (currently returns fallback)
6. Switch to `success` view with completion date

### Status Management
Volumes have three states (defined in [types.ts:2](types.ts#L2)):
- `UNCLAIMED`: Available for claiming
- `CLAIMED`: Someone has claimed it, deadline not passed
- `COMPLETED`: Deadline has passed (auto-marked in `dbService.getVolumes()`)

### Date Calculation
Completion date = claim date + `plannedDays`:
```typescript
expectedCompletionDate.setDate(claimedAt.getDate() + request.plannedDays)
```

## Critical Files

- [App.tsx](App.tsx): Entire UI, all views, form handling
- [dbService.ts](dbService.ts): LocalStorage + SheetDB sync logic
- [server.js](server.js): Backend API, SheetDB integration
- [data.ts](data.ts): Initial volume dataset (700+ volumes)
- [types.ts](types.ts): TypeScript interfaces
- [vite.config.ts](vite.config.ts): Vite configuration, env var injection

## Known Issues & Notes

1. **Gemini Service Disabled**: The AI blessing feature is commented out in [geminiService.ts:4](geminiService.ts#L4) to avoid Vite build errors
2. **LocalStorage-First Design**: The app works completely offline; SheetDB is optional
3. **No Authentication**: Anyone can claim any volume
4. **Client-Side Validation Only**: No server-side validation of claim data
5. **Hardcoded Volume List**: All volumes are defined in [data.ts](data.ts), not loaded from external source
6. **CORS Configuration**: [server.js:105](server.js#L105) has a duplicate CORS config (already enabled on line 12)

## Google Sheets Integration

If using SheetDB, the Google Sheet must have these columns:
```
volumeId | volumeNumber | volumeTitle | name | phone | plannedDays | readingUrl | claimedAt | expectedCompletionDate | status
```

## Styling

- Uses Tailwind CSS via inline classes
- Custom color palette: `#5c4033`, `#8b7355`, `#fdfbf7` (brown/beige theme)
- Serif fonts for Chinese text: `serif-title`, `calligraphy` classes
- Animations: `fade-in` class with staggered delays

## Path Aliasing

TypeScript and Vite both configured with `@/*` → project root:
```typescript
import { dbService } from '@/dbService'
```
