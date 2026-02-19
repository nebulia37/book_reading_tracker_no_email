import { Volume, VolumeStatus } from './types';

/**
 * Prajna Section
 * Verified Source: Xianmi Jingzang (w1.xianmijingzang.com)
 * Collection ID: 43
 */

const BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/43/subid/';

// 15 section prefaces in the upstream catalog — each is an extra book entry
// inserted before the scroll it introduces. Key = scroll number, value = preface bookId.
const PREFACE_FOR_SCROLL: Record<number, number> = {
  401: 2470,
  479: 2549,
  538: 2609,
  556: 2628,
  566: 2639,
  574: 2648,
  576: 2651,
  577: 2653,
  578: 2655,
  579: 2657,
  584: 2663,
  589: 2669,
  590: 2671,
  591: 2673,
  593: 2676
};

/**
 * Map scroll (1-600) to upstream book IDs.
 * Scrolls with a section preface return prefaceBookId for the preface entry.
 */
export function getScrollMapping(scroll: number): { bookId: number; prefaceBookId?: number } {
  const prefacesBefore = Object.entries(PREFACE_FOR_SCROLL).reduce((count, [s]) => {
    return Number(s) < scroll ? count + 1 : count;
  }, 0);

  const prefaceBookId = PREFACE_FOR_SCROLL[scroll];
  const hasPreface = !!prefaceBookId;
  const bookId = 2069 + scroll + prefacesBefore + (hasPreface ? 1 : 0);

  return { bookId, prefaceBookId: hasPreface ? prefaceBookId : undefined };
}

const createSutraVolumes = (
  subid: number,
  part: number,
  title: string,
  scrolls: number
): Volume[] => {
  const volumes: Volume[] = [];
  for (let i = 301; i <= scrolls; i++) {
    const { bookId, prefaceBookId } = getScrollMapping(i);
    volumes.push({
      id: `${part}${String(i).padStart(3, '0')}`,
      part,
      scroll: i,
      volumeNumber: `第${part}部-卷${i}`,
      volumeTitle: `${title} 卷${i}`,
      status: VolumeStatus.UNCLAIMED,
      readingUrl: `${BASE_URL}${subid}/`,
      bookId,
      prefaceBookId
    });
  }
  return volumes;
};

const prajna: Volume[] = [
  ...createSutraVolumes(67, 1, '大般若波罗蜜多经', 600),
];

export const INITIAL_VOLUMES: Volume[] = prajna;
