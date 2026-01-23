import { Volume, VolumeStatus, ClaimRequest } from './types';
import { INITIAL_VOLUMES } from './data';

const DB_KEY = 'longzang_tripitaka_volumes_v12';

export const dbService = {
  getVolumes: async (): Promise<Volume[]> => {
    try {
      const data = localStorage.getItem(DB_KEY);
      let volumes: Volume[] = data ? JSON.parse(data) : [...INITIAL_VOLUMES];

      try {
        const response = await fetch('https://book-reading-tracker-no-email.onrender.com/api/claims');
        if (response.ok) {
          const claimsData = await response.json();
          const claims = claimsData.data || claimsData;

          volumes = volumes.map(volume => {
            const claim = claims.find((c: any) => String(c.volumeId) === String(volume.id));
            if (claim) {
              return {
                ...volume,
                status: VolumeStatus.CLAIMED,
                claimerName: claim.name,
                claimerPhone: claim.phone,
                plannedDays: claim.plannedDays,
                claimedAt: claim.claimedAt,
                expectedCompletionDate: claim.expectedCompletionDate
              };
            }
            return volume;
          });
        }
      } catch (error) {
        console.warn('Failed to fetch claims from SheetDB, using local data only:', error);
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
    const data = localStorage.getItem(DB_KEY);
    const volumes: Volume[] = data ? JSON.parse(data) : [...INITIAL_VOLUMES];

    const index = volumes.findIndex(v => v.id === request.volumeId);

    if (index === -1) return null;
    if (volumes[index].status !== VolumeStatus.UNCLAIMED) {
      throw new Error('该卷册已被认领，请刷新页面查看最新状态。');
    }

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
      expectedCompletionDate: expectedCompletionDate.toISOString()
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