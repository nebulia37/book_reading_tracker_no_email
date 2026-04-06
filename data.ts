import { Volume, VolumeStatus } from './types';

/**
 * Scripture Catalog: Parts 83-108 (大乘华严部)
 * Collection ID: 45
 * From xianmijingzang.com
 */
export interface ScriptureCatalogEntry {
  part: number;
  title: string;
  subid: number;
  scrollCount: number;
  firstBookId: number;
  collectionId: number;
  has0aPreface?: boolean;   // True if first file(s) are "0x" preface merged with first numbered scroll
  mergeFileCount?: number;  // How many files merge into scroll 1 (leading merge; default 2)
  trailingMergeCount?: number; // How many trailing files merge into the last scroll (e.g. 40a+40b → 2)
  audioOverrides?: { [scroll: number]: string };
  subidOverrides?: { [scroll: number]: number };
}

export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [
];

/**
 * Generate volumes from the scripture catalog.
 * Each scroll in each scripture becomes one claimable volume.
 * Handles leading 0x merges (has0aPreface/mergeFileCount) and
 * trailing Xa/Xb merges (trailingMergeCount).
 */
const createCatalogVolumes = (): Volume[] => {
  const volumes: Volume[] = [];
  for (const entry of SCRIPTURE_CATALOG) {
    const has0aPreface = entry.has0aPreface === true;
    const leadMerge = has0aPreface ? (entry.mergeFileCount || 2) : 0;
    const trailMerge = entry.trailingMergeCount || 1;
    const effectiveScrolls = entry.scrollCount - (leadMerge > 0 ? leadMerge - 1 : 0) - (trailMerge - 1);

    for (let scroll = 1; scroll <= effectiveScrolls; scroll++) {
      const bookId = has0aPreface
        ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + leadMerge + (scroll - 2))
        : entry.firstBookId + scroll - 1;

      const hasMultipleScrolls = effectiveScrolls > 1;
      volumes.push({
        id: `${entry.part}_${scroll}`,
        part: entry.part,
        scroll,
        volumeNumber: hasMultipleScrolls ? `第${entry.part}部-卷${scroll}` : `第${entry.part}部`,
        volumeTitle: hasMultipleScrolls ? `${entry.title} 卷${scroll}` : entry.title,
        status: VolumeStatus.UNCLAIMED,
        readingUrl: `https://w1.xianmijingzang.com/wap/tripitaka/id/${entry.collectionId}/subid/${entry.subid}/`,
        bookId,
        collectionId: entry.collectionId,
        subid: entry.subid
      });
    }
  }
  return volumes;
};

export const INITIAL_VOLUMES: Volume[] = createCatalogVolumes();
