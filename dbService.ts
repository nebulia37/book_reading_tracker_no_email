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
          const claims = await response.json();
          
          volumes = volumes.map(volume => {
            // Match volumeId from SheetDB (string/number) to volume.id
            const claim = claims.find((c: any) => String(c.volumeId) === String(volume.id));
            if (claim) {
              return {
                ...volume,
                status: VolumeStatus.CLAIMED,
                claimerName: claim.name,
                claimerPhone: claim.phone,
                plannedDays: parseInt(claim.plannedDays),
                claimedAt: claim.claimedAt,
                expectedCompletionDate: claim.expectedCompletionDate
              };
            }
            return volume;
          });
        }
      } catch (error) {
        console.warn('Failed to fetch from SheetDB:', error);
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
      return [...INITIAL_VOLUMES];
    }
  },

  // FIXED: Properly implemented async function with all logic inside
  claimVolume: async (request: ClaimRequest): Promise<Volume | null> => {
    claimVolume: async (request: ClaimRequest): Promise<Volume | null> => {
  // 1. You MUST await here. If you miss 'await', volumes is a Promise object.
  const volumesData = await dbService.getVolumes(); 

  // 2. Safety check: If SheetDB or LocalStorage returned an object by mistake, 
  // ensure we are working with the array inside it.
  const volumes = Array.isArray(volumesData) ? volumesData : (volumesData as any).volumes || [];

  if (!Array.isArray(volumes)) {
    console.error("Volumes is not an array!", volumes);
    return null;
  }

  // 3. Match using string conversion to avoid type mismatches from SheetDB
  const index = volumes.findIndex(v => String(v.id) === String(request.volumeId));
  
    
    if (index === -1) return null;
    if (volumes[index].status !== VolumeStatus.UNCLAIMED) {
      throw new Error('该卷册已被认领，请刷新页面查看最新状态。');
    }

    const claimedAt = new Date();
    const expectedCompletionDate = new Date(claimedAt);
    expectedCompletionDate.setDate(claimedAt.getDate() + (request.plannedDays || 7));

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
  }, // Added missing comma here

  reset: () => {
    localStorage.removeItem(DB_KEY);
    window.location.reload();
  }
};