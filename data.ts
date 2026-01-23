import { Volume, VolumeStatus } from './types';

/**
 * 般若部 (Prajna Section) 
 * Verified Source: Xianmi Jingzang (w1.xianmijingzang.com)
 * Collection ID: 43
 */

const BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/43/subid/';

const createSutraVolumes = (
  startId: number,
  subid: number,
  part: number,
  title: string,
  scrolls: number
): Volume[] => {
  const volumes: Volume[] = [];
  for (let i = 1; i <= scrolls; i++) {
    volumes.push({
      id: startId + i,
      volumeNumber: `第${part}部 卷${i}`,
      volumeTitle: `${title} 卷${i}`,
      status: VolumeStatus.UNCLAIMED,
      readingUrl: `${BASE_URL}${subid}/`
    });
  }
  return volumes;
};

// Based on the verified SubID list for the Prajna section (id/43)
const prajna: Volume[] = [
  ...createSutraVolumes(1000, 67, 1, '大般若波羅蜜多j', 600),
  ...createSutraVolumes(2000, 68, 2, '放光般若波羅蜜j', 30),
  ...createSutraVolumes(3000, 69, 3, '摩訶般若波羅蜜j', 30),
  ...createSutraVolumes(4000, 70, 4, '光讚般若波羅蜜j', 10),
  ...createSutraVolumes(5000, 71, 5, '道行般若波羅蜜j', 10),
  ...createSutraVolumes(6000, 75, 6, '小品般若波羅蜜j', 10),
  ...createSutraVolumes(7000, 76, 7, '摩訶般若波羅蜜鈔j', 5),
  ...createSutraVolumes(8000, 80, 9, '勝天王般若波羅蜜j', 7),
  ...createSutraVolumes(9000, 90, 19, '文殊師利所說般若波羅蜜j', 1),
];

export const INITIAL_VOLUMES: Volume[] = prajna;
