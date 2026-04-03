import { Volume, VolumeStatus, ClaimRequest } from './types';
import { INITIAL_VOLUMES } from './data';

const DB_KEY = 'longzang_tripitaka_volumes_v15';
const API_BASE_URL = import.meta.env.DEV
  ? 'http://localhost:3001'
  : import.meta.env.VITE_API_URL;
const COMPLETED_STATUS_VALUES = new Set(['completed', 'complete', 'done', '已完成']);
const isCompletedStatus = (status: unknown): boolean =>
  COMPLETED_STATUS_VALUES.has(String(status ?? '').trim().toLowerCase());

export const dbService = {
  getVolumes: async (): Promise<Volume[]> => {
    try {
      // Always start with fresh INITIAL_VOLUMES (all unclaimed)
      let volumes: Volume[] = [...INITIAL_VOLUMES];

      try {
        // Add 10 second timeout so page loads faster if server is sleeping
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 10000);

        const response = await fetch(`${API_BASE_URL}/api/claims`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (response.ok) {
          const claimsData = await response.json();
          const claims = claimsData.data || claimsData;

          // Overlay claims from Supabase onto fresh volumes
          volumes = volumes.map(volume => {
            const claim = claims.find((c: any) => String(c.volumeId) === String(volume.id));
            if (claim) {
              const isCompleted = isCompletedStatus(claim.status);
              return {
                ...volume,
                status: isCompleted ? VolumeStatus.COMPLETED : VolumeStatus.CLAIMED,
                claimerName: claim.name,
                claimerPhone: claim.phone,
                plannedDays: claim.plannedDays,
                claimedAt: claim.claimedAt,
                expectedCompletionDate: claim.expectedCompletionDate,
                remarks: claim.remarks
              };
            }
            return volume;
          });
        }
      } catch (error) {
        console.warn('Failed to fetch claims from Supabase, using local data only:', error);
        // If Supabase fetch fails, try to merge localStorage claims with INITIAL_VOLUMES
        // Don't replace volumes entirely - just overlay any cached claim info
        try {
          const data = localStorage.getItem(DB_KEY);
          if (data) {
            const cachedVolumes = JSON.parse(data);
            volumes = volumes.map(volume => {
              const cached = cachedVolumes.find((c: any) => String(c.id) === String(volume.id));
              if (cached && cached.status !== VolumeStatus.UNCLAIMED) {
                const isCompleted = volume.scroll <= 300 || cached.status === VolumeStatus.COMPLETED;
                return {
                  ...volume,
                  status: isCompleted ? VolumeStatus.COMPLETED : cached.status,
                  claimerName: cached.claimerName,
                  claimerPhone: cached.claimerPhone,
                  plannedDays: cached.plannedDays,
                  claimedAt: cached.claimedAt,
                  expectedCompletionDate: cached.expectedCompletionDate,
                  remarks: cached.remarks
                };
              }
              return volume;
            });
          }
        } catch (cacheError) {
          console.warn('Failed to parse localStorage cache:', cacheError);
        }
      }

      return volumes;
    } catch (e) {
      console.error("Failed to load volumes from storage:", e);
      return [...INITIAL_VOLUMES];
    }
  },

  claimVolume: (request: ClaimRequest): Volume | null => {
    // Always start with fresh INITIAL_VOLUMES
    const volumes: Volume[] = [...INITIAL_VOLUMES];

    const index = volumes.findIndex(v => v.id === request.volumeId);

    if (index === -1) return null;
    // Remove the status check here - let the backend/Google Sheet handle validation
    // The frontend should trust the UI state which comes from Google Sheet

    const claimedAt = new Date();
    const expectedCompletionDate = new Date(claimedAt);
    expectedCompletionDate.setDate(claimedAt.getDate() + request.plannedDays);

    const updatedVolume: Volume = {
      ...volumes[index],
      status: VolumeStatus.CLAIMED,
      claimerName: request.name,
      claimerPhone: request.phone,
      plannedDays: request.plannedDays,
      claimedAt: claimedAt.toISOString(),
      expectedCompletionDate: expectedCompletionDate.toISOString(),
      remarks: request.remarks
    };

    volumes[index] = updatedVolume;
    localStorage.setItem(DB_KEY, JSON.stringify(volumes));
    return updatedVolume;
  },

  completeVolume: async (volume: Volume): Promise<Volume | null> => {
    const volumeId = String(volume.id);
    const response = await fetch(`${API_BASE_URL}/api/complete`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        volumeId,
        part: volume.part,
        scroll: volume.scroll,
        volumeNumber: volume.volumeNumber
      })
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `Backend returned ${response.status}`);
    }

    const payload = await response.json();
    const claim = payload.claim || {};

    const volumes = await dbService.getVolumes();
    const matched = volumes.find(v => v.id === volumeId);
    if (!matched) return null;

    const completedVolume: Volume = {
      ...matched,
      status: VolumeStatus.COMPLETED,
      claimerName: claim.name || matched.claimerName,
      claimerPhone: claim.phone || matched.claimerPhone
    };
    return completedVolume;
  },

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  }
};
