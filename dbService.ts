import { Volume, VolumeStatus, ClaimRequest } from './types';
import { INITIAL_VOLUMES } from './data';

const DB_KEY = 'longzang_tripitaka_volumes_v13';
const API_BASE_URL = import.meta.env.VITE_API_URL;

export const dbService = {
  getVolumes: async (): Promise<Volume[]> => {
    try {
      // Always start with fresh INITIAL_VOLUMES (all unclaimed)
      let volumes: Volume[] = [...INITIAL_VOLUMES];

      try {
        const response = await fetch(`${API_BASE_URL}/api/claims`);
        if (response.ok) {
          const claimsData = await response.json();
          const claims = claimsData.data || claimsData;

          // Overlay claims from Supabase onto fresh volumes
          const now = new Date();
          volumes = volumes.map(volume => {
            const claim = claims.find((c: any) => String(c.volumeId) === String(volume.id));
            if (claim) {
              // Check if expectedCompletionDate has passed - mark as COMPLETED
              const isCompleted = claim.expectedCompletionDate && now >= new Date(claim.expectedCompletionDate);
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
        // If Supabase fetch fails, try to use localStorage as fallback
        const data = localStorage.getItem(DB_KEY);
        if (data) {
          volumes = JSON.parse(data);
        }
      }

      const now = new Date();
      let modified = false;
      volumes = volumes.map(v => {
        if (v.status === VolumeStatus.CLAIMED && v.expectedCompletionDate) {
          if (now >= new Date(v.expectedCompletionDate)) {
            modified = true;
            return { ...v, status: VolumeStatus.COMPLETED };
          }
        }
        return v;
      });

      if (modified) localStorage.setItem(DB_KEY, JSON.stringify(volumes));
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

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  }
};