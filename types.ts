
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
  bookId: number;              // upstream book ID for scripture content
  prefaceBookId?: number;      // upstream book ID for section preface (if any)
  collectionId: number;        // upstream collection ID (43 = prajna, 47 = parts 122-371)
  subid: number;               // upstream subid within collection
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
