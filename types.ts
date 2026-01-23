
export enum VolumeStatus {
  UNCLAIMED = 'unclaimed',
  CLAIMED = 'claimed',
  COMPLETED = 'completed'
}

export interface Volume {
  id: number;
  volumeNumber: string;
  volumeTitle: string;
  status: VolumeStatus;
  claimerName?: string;
  claimerEmail?: string;
  claimerPhone?: string;
  plannedDays?: number;
  claimedAt?: string;
  expectedCompletionDate?: string;
  readingUrl: string;
}

export interface ClaimRequest {
  volumeId: number;
  name: string;
  email: string;
  phone: string;
  plannedDays: number;
  readingUrl: string; // Added readingUrl to request
}

export type AppView = 'home' | 'claim' | 'success';
