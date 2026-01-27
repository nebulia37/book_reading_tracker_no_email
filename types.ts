
export enum VolumeStatus {
  UNCLAIMED = 'unclaimed',
  CLAIMED = 'claimed',
  COMPLETED = 'completed'
}

export interface Volume {
  id: string;
  part: number;      // 部
  scroll: number;    // 卷
  volumeNumber: string;
  volumeTitle: string;
  status: VolumeStatus;
  claimerName?: string;
  claimerPhone?: string;
  plannedDays?: number;
  claimedAt?: string;
  expectedCompletionDate?: string;
  readingUrl: string;
  remarks?: string;
}

export interface ClaimRequest {
  volumeId: string;
  part: number;      // 部
  scroll: number;    // 卷
  volumeNumber: string;
  volumeTitle: string;
  name: string;
  phone: string;
  plannedDays: number;
  readingUrl: string;
  remarks?: string;
}

export type AppView = 'home' | 'claim' | 'success' | 'scripture';
