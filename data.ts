import { Volume, VolumeStatus } from './types';

/**
 * 般若部 (Prajna Section) 
 * Verified Source: Xianmi Jingzang (w1.xianmijingzang.com)
 * Collection ID: 43
 */

const BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/43/subid/';

const createSutraVolumes = (
  subid: number,
  part: number,
  title: string,
  scrolls: number
): Volume[] => {
  const volumes: Volume[] = [];
  for (let i = 1; i <= scrolls; i++) {
    volumes.push({
      id: `${part}${String(i).padStart(3, '0')}`,
      part: part,
      scroll: i,
      volumeNumber: `第${part}部-卷${i}`,
      volumeTitle: `${title} 卷${i}`,
      status: VolumeStatus.UNCLAIMED,
      readingUrl: `${BASE_URL}${subid}/`
    });
  }
  return volumes;
};

// Based on the verified SubID list for the Prajna section (id/43)
const prajna: Volume[] = [
  ...createSutraVolumes(67, 1, '大般若波羅蜜多經', 200),
];

export const INITIAL_VOLUMES: Volume[] = prajna;
