import { Volume, VolumeStatus } from './types';

/**
 * Scripture Catalog: Parts 83-108 (大乘华严部)
 * Collection ID: 43
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
  { part: 83, title: '大方廣佛華嚴經', subid: 152, scrollCount: 60, firstBookId: 3136, collectionId: 43 },
  { part: 84, title: '大方廣佛華嚴經', subid: 153, scrollCount: 81, firstBookId: 3196, collectionId: 43, has0aPreface: true, mergeFileCount: 2 },
  { part: 85, title: '大方廣佛華嚴經', subid: 154, scrollCount: 41, firstBookId: 3277, collectionId: 43, trailingMergeCount: 2 },
  { part: 86, title: '信力入印法門經', subid: 155, scrollCount: 5, firstBookId: 3318, collectionId: 43 },
  { part: 87, title: '大方廣佛華嚴經', subid: 156, scrollCount: 1, firstBookId: 3323, collectionId: 43 },
  { part: 88, title: '佛說如來興顯經', subid: 157, scrollCount: 4, firstBookId: 3324, collectionId: 43 },
  { part: 89, title: '大方廣入如來智德不思議經', subid: 158, scrollCount: 1, firstBookId: 3328, collectionId: 43 },
  { part: 90, title: '大方廣佛華嚴經修慈分', subid: 159, scrollCount: 1, firstBookId: 3329, collectionId: 43 },
  { part: 91, title: '顯無邊佛土功徳經', subid: 160, scrollCount: 1, firstBookId: 3330, collectionId: 43 },
  { part: 92, title: '大方廣佛華嚴經不思議佛境界分', subid: 161, scrollCount: 1, firstBookId: 3331, collectionId: 43 },
  { part: 93, title: '大方廣如來不思議境界經', subid: 162, scrollCount: 1, firstBookId: 3332, collectionId: 43 },
  { part: 94, title: '大方廣普賢所說經', subid: 163, scrollCount: 1, firstBookId: 3333, collectionId: 43 },
  { part: 95, title: '莊嚴菩提心經', subid: 164, scrollCount: 1, firstBookId: 3334, collectionId: 43 },
  { part: 96, title: '佛說菩薩本業經', subid: 165, scrollCount: 1, firstBookId: 3335, collectionId: 43 },
  { part: 97, title: '大方廣佛華嚴經續入法界品', subid: 166, scrollCount: 1, firstBookId: 3336, collectionId: 43 },
  { part: 98, title: '佛說兠沙經', subid: 167, scrollCount: 1, firstBookId: 3337, collectionId: 43 },
  { part: 99, title: '大方廣菩薩十地經', subid: 168, scrollCount: 1, firstBookId: 3338, collectionId: 43 },
  { part: 100, title: '度世品經', subid: 169, scrollCount: 6, firstBookId: 3339, collectionId: 43 },
  { part: 101, title: '十住經', subid: 170, scrollCount: 6, firstBookId: 3345, collectionId: 43 },
  { part: 102, title: '佛說羅摩伽經', subid: 171, scrollCount: 4, firstBookId: 3351, collectionId: 43 },
  { part: 103, title: '諸菩薩求佛本業經', subid: 172, scrollCount: 1, firstBookId: 3355, collectionId: 43 },
  { part: 104, title: '菩薩十住行道品經', subid: 173, scrollCount: 1, firstBookId: 3356, collectionId: 43 },
  { part: 105, title: '佛說菩薩十住經', subid: 174, scrollCount: 1, firstBookId: 3357, collectionId: 43 },
  { part: 106, title: '漸備一切智德經', subid: 175, scrollCount: 5, firstBookId: 3358, collectionId: 43 },
  { part: 107, title: '等目菩薩所問三昧經', subid: 176, scrollCount: 3, firstBookId: 3363, collectionId: 43 },
  { part: 108, title: '文殊師利問菩薩署經', subid: 177, scrollCount: 1, firstBookId: 3366, collectionId: 43 },
];

const CATALOG_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/43/subid/';

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
        readingUrl: `${CATALOG_BASE_URL}${entry.subid}/`,
        bookId,
        collectionId: entry.collectionId,
        subid: entry.subid
      });
    }
  }
  return volumes;
};

export const INITIAL_VOLUMES: Volume[] = createCatalogVolumes();
