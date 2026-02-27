import { Volume, VolumeStatus } from './types';

/**
 * Prajna Section (Part 1)
 * Verified Source: Xianmi Jingzang (w1.xianmijingzang.com)
 * Collection ID: 43, Subid: 67
 */

const PRAJNA_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/43/subid/';

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
 * Map scroll (1-600) to upstream book IDs for Part 1 (Prajna).
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

const createPrajnaVolumes = (): Volume[] => {
  const volumes: Volume[] = [];
  for (let i = 301; i <= 600; i++) {
    const { bookId, prefaceBookId } = getScrollMapping(i);
    volumes.push({
      id: `1${String(i).padStart(3, '0')}`,
      part: 1,
      scroll: i,
      volumeNumber: `第1部-卷${i}`,
      volumeTitle: `大般若波罗蜜多经 卷${i}`,
      status: VolumeStatus.UNCLAIMED,
      readingUrl: `${PRAJNA_BASE_URL}67/`,
      bookId,
      prefaceBookId,
      collectionId: 43,
      subid: 67
    });
  }
  return volumes;
};

/**
 * Scripture Catalog: Parts 122-371
 * Collection ID: 47
 * Scraped from xianmijingzang.com
 */
export interface ScriptureCatalogEntry {
  part: number;
  title: string;
  subid: number;
  scrollCount: number;
  firstBookId: number;
  collectionId: number;
  has0aPreface?: boolean;  // True if first bookId is "0a" preface that merges with "0b" or "01" into scroll 1
  mergeFileCount?: number; // Number of files to merge into scroll 1 (default: 2 for "0a+0b", but can be 3 for "0a+0b+1")
  audioOverrides?: { [scroll: number]: string }; // Override audio URLs for specific scrolls
  subidOverrides?: { [scroll: number]: number }; // Override subids for specific scrolls when using different parts' bookIds
}

export const SCRIPTURE_CATALOG: ScriptureCatalogEntry[] = [
  { part: 122, title: '金光明最勝王經', subid: 191, scrollCount: 11, firstBookId: 3470, collectionId: 47, has0aPreface: true },
  { part: 123, title: '金光明經', subid: 192, scrollCount: 5, firstBookId: 3481, collectionId: 47, has0aPreface: true },
  { part: 124, title: '等集衆德三昧經', subid: 193, scrollCount: 3, firstBookId: 3486, collectionId: 47 },
  { part: 125, title: '集一切福德三昧經', subid: 194, scrollCount: 3, firstBookId: 3489, collectionId: 47 },
  { part: 126, title: '合部金光明經', subid: 195, scrollCount: 9, firstBookId: 3492, collectionId: 47, has0aPreface: true },
  { part: 127, title: '入定不定印經', subid: 196, scrollCount: 2, firstBookId: 3501, collectionId: 47, has0aPreface: true },
  { part: 128, title: '不必定入定入印經', subid: 197, scrollCount: 2, firstBookId: 3503, collectionId: 47, has0aPreface: true },
  { part: 129, title: '無量義經', subid: 198, scrollCount: 2, firstBookId: 3505, collectionId: 47, has0aPreface: true },
  { part: 130, title: '妙法蓮華經', subid: 199, scrollCount: 9, firstBookId: 3507, collectionId: 47, has0aPreface: true },
  { part: 131, title: '法華三昧經', subid: 200, scrollCount: 1, firstBookId: 3516, collectionId: 47 },
  { part: 132, title: '薩曇芬陀利經', subid: 201, scrollCount: 1, firstBookId: 3517, collectionId: 47 },
  { part: 133, title: '妙法蓮華經觀世音菩薩普門品經', subid: 202, scrollCount: 2, firstBookId: 3518, collectionId: 47, has0aPreface: true },
  { part: 134, title: '正法華經', subid: 203, scrollCount: 10, firstBookId: 3520, collectionId: 47 },
  { part: 135, title: '妙法蓮華經', subid: 204, scrollCount: 9, firstBookId: 3530, collectionId: 47, has0aPreface: true },
  { part: 136, title: '分别縁起初勝法門經', subid: 205, scrollCount: 2, firstBookId: 3539, collectionId: 47 },
  { part: 137, title: '佛說縁生初勝分法本經', subid: 206, scrollCount: 3, firstBookId: 3541, collectionId: 47, has0aPreface: true },
  { part: 138, title: '悲華經', subid: 207, scrollCount: 10, firstBookId: 3544, collectionId: 47 },
  { part: 139, title: '六度集經', subid: 208, scrollCount: 8, firstBookId: 3554, collectionId: 47 },
  { part: 140, title: '大乗頂王經', subid: 209, scrollCount: 1, firstBookId: 3562, collectionId: 47 },
  { part: 141, title: '大方等頂王經', subid: 210, scrollCount: 1, firstBookId: 3563, collectionId: 47 },
  { part: 142, title: '維摩詰所說大乘經', subid: 211, scrollCount: 3, firstBookId: 3564, collectionId: 47 },
  { part: 143, title: '維摩詰經', subid: 212, scrollCount: 3, firstBookId: 3567, collectionId: 47 },
  { part: 144, title: '道神足無極變化經', subid: 213, scrollCount: 4, firstBookId: 3570, collectionId: 47 },
  { part: 145, title: '說無垢稱經', subid: 214, scrollCount: 6, firstBookId: 3574, collectionId: 47 },
  { part: 146, title: '阿惟越致遮經', subid: 215, scrollCount: 4, firstBookId: 3580, collectionId: 47 },
  { part: 147, title: '佛說寳雨經', subid: 216, scrollCount: 10, firstBookId: 3584, collectionId: 47 },
  { part: 148, title: '佛說寳雲經', subid: 217, scrollCount: 7, firstBookId: 3594, collectionId: 47 },
  { part: 149, title: '佛昇忉利天爲母說法經', subid: 218, scrollCount: 3, firstBookId: 3601, collectionId: 47 },
  { part: 150, title: '相續解脫地波羅蜜了義經', subid: 219, scrollCount: 1, firstBookId: 3604, collectionId: 47 },
  { part: 151, title: '相續解脫如來所作隨順處了義經', subid: 220, scrollCount: 1, firstBookId: 3605, collectionId: 47 },
  { part: 152, title: '佛說解節經', subid: 221, scrollCount: 1, firstBookId: 3606, collectionId: 47 },
  { part: 153, title: '不退轉法輪經', subid: 222, scrollCount: 4, firstBookId: 3607, collectionId: 47 },
  { part: 154, title: '廣博嚴淨不退轉法輪經', subid: 223, scrollCount: 4, firstBookId: 3611, collectionId: 47 },
  { part: 155, title: '方廣大莊嚴經', subid: 224, scrollCount: 13, firstBookId: 3615, collectionId: 47, has0aPreface: true },
  { part: 156, title: '普曜經', subid: 225, scrollCount: 8, firstBookId: 3628, collectionId: 47 },
  { part: 157, title: '伅眞陀羅所問寳如來三昧經', subid: 226, scrollCount: 3, firstBookId: 3636, collectionId: 47 },
  { part: 158, title: '大樹緊那羅王所問經', subid: 227, scrollCount: 4, firstBookId: 3639, collectionId: 47 },
  { part: 159, title: '諸法本無經', subid: 228, scrollCount: 3, firstBookId: 3643, collectionId: 47 },
  { part: 160, title: '諸法無行經', subid: 229, scrollCount: 2, firstBookId: 3646, collectionId: 47 },
  { part: 161, title: '持人菩薩所問經', subid: 230, scrollCount: 4, firstBookId: 3648, collectionId: 47 },
  { part: 162, title: '持世經', subid: 231, scrollCount: 4, firstBookId: 3652, collectionId: 47 },
  { part: 163, title: '佛說大灌頂神呪經', subid: 232, scrollCount: 12, firstBookId: 3656, collectionId: 47 },
  { part: 164, title: '佛說文殊師利現寳藏經', subid: 233, scrollCount: 2, firstBookId: 3668, collectionId: 47 },
  { part: 165, title: '大方廣寳篋經', subid: 234, scrollCount: 2, firstBookId: 3670, collectionId: 47 },
  { part: 166, title: '佛說藥師如來本願經', subid: 235, scrollCount: 2, firstBookId: 3672, collectionId: 47, has0aPreface: true },
  { part: 167, title: '藥師瑠璃光如來本願功徳經', subid: 236, scrollCount: 1, firstBookId: 3674, collectionId: 47 },
  { part: 168, title: '藥師瑠璃光七佛本願功徳經', subid: 237, scrollCount: 2, firstBookId: 3675, collectionId: 47 },
  { part: 169, title: '番字藥師七佛本願功徳經', subid: 238, scrollCount: 1, firstBookId: 3677, collectionId: 47 },
  { part: 170, title: '佛說阿闍世王經', subid: 239, scrollCount: 2, firstBookId: 3678, collectionId: 47 },
  { part: 171, title: '楞伽阿跋多羅寳經', subid: 240, scrollCount: 4, firstBookId: 3680, collectionId: 47 },
  { part: 172, title: '入楞伽經', subid: 241, scrollCount: 10, firstBookId: 3684, collectionId: 47 },
  { part: 173, title: '大乗入楞伽經', subid: 242, scrollCount: 8, firstBookId: 3694, collectionId: 47, has0aPreface: true },
  { part: 174, title: '菩薩行方便境界神通變化經', subid: 243, scrollCount: 3, firstBookId: 3702, collectionId: 47 },
  { part: 175, title: '大薩遮尼乾子受記經', subid: 244, scrollCount: 11, firstBookId: 3705, collectionId: 47 },
  { part: 176, title: '大乗大悲分陀利經', subid: 245, scrollCount: 8, firstBookId: 3716, collectionId: 47 },
  { part: 177, title: '善思童子經', subid: 246, scrollCount: 2, firstBookId: 3724, collectionId: 47 },
  { part: 178, title: '普超三昧經', subid: 247, scrollCount: 4, firstBookId: 3726, collectionId: 47 },
  { part: 179, title: '佛說放鉢經', subid: 248, scrollCount: 1, firstBookId: 3730, collectionId: 47 },
  { part: 180, title: '佛說大淨法門品經', subid: 249, scrollCount: 1, firstBookId: 3731, collectionId: 47 },
  { part: 181, title: '大莊嚴法門經', subid: 250, scrollCount: 2, firstBookId: 3732, collectionId: 47 },
  { part: 182, title: '佛說大方等大雲請雨經', subid: 251, scrollCount: 1, firstBookId: 3734, collectionId: 47 },
  { part: 183, title: '大雲請雨經', subid: 252, scrollCount: 1, firstBookId: 3735, collectionId: 47 },
  { part: 184, title: '大雲輪請雨經', subid: 253, scrollCount: 2, firstBookId: 3736, collectionId: 47 },
  { part: 185, title: '勝思惟梵天所問經', subid: 254, scrollCount: 6, firstBookId: 3738, collectionId: 47 },
  { part: 186, title: '思益梵天所問經', subid: 255, scrollCount: 4, firstBookId: 3744, collectionId: 47 },
  { part: 187, title: '月燈三昧經', subid: 256, scrollCount: 11, firstBookId: 3748, collectionId: 47 },
  { part: 188, title: '月燈三昧經', subid: 257, scrollCount: 1, firstBookId: 3759, collectionId: 47 },
  { part: 189, title: '佛說象腋經', subid: 258, scrollCount: 1, firstBookId: 3760, collectionId: 47 },
  { part: 190, title: '佛說無所希望經', subid: 259, scrollCount: 1, firstBookId: 3761, collectionId: 47 },
  { part: 191, title: '佛說大乗同性經', subid: 260, scrollCount: 2, firstBookId: 3762, collectionId: 47 },
  { part: 192, title: '佛說證契大乗經', subid: 261, scrollCount: 3, firstBookId: 3764, collectionId: 47, has0aPreface: true },
  { part: 193, title: '持心梵天所問經', subid: 262, scrollCount: 4, firstBookId: 3767, collectionId: 47 },
  { part: 194, title: '佛說觀無量壽佛經', subid: 263, scrollCount: 2, firstBookId: 3771, collectionId: 47, has0aPreface: true },
  { part: 195, title: '稱讃淨土佛攝受經', subid: 264, scrollCount: 1, firstBookId: 3773, collectionId: 47 },
  { part: 196, title: '佛說阿彌陀經', subid: 265, scrollCount: 1, firstBookId: 3774, collectionId: 47 },
  { part: 197, title: '拔一切業障根本得生淨土神呪', subid: 266, scrollCount: 1, firstBookId: 3775, collectionId: 47 },
  { part: 198, title: '後出阿彌陀佛偈經', subid: 267, scrollCount: 1, firstBookId: 3776, collectionId: 47 },
  { part: 199, title: '佛說大阿彌陀經', subid: 268, scrollCount: 3, firstBookId: 3777, collectionId: 47, has0aPreface: true },
  { part: 200, title: '佛說觀彌勒菩薩上生兠率陀天經', subid: 269, scrollCount: 1, firstBookId: 3780, collectionId: 47 },
  { part: 201, title: '佛說彌勒下生經', subid: 270, scrollCount: 1, firstBookId: 3781, collectionId: 47 },
  { part: 202, title: '佛說彌勒來時經', subid: 272, scrollCount: 1, firstBookId: 3782, collectionId: 47 },
  { part: 203, title: '佛說彌勒下生成佛經', subid: 274, scrollCount: 1, firstBookId: 3783, collectionId: 47 },
  { part: 204, title: '佛說觀彌勒菩薩下生經', subid: 275, scrollCount: 1, firstBookId: 3784, collectionId: 47 },
  { part: 205, title: '佛說彌勒成佛經', subid: 276, scrollCount: 1, firstBookId: 3785, collectionId: 47 },
  { part: 206, title: '佛說第一義法勝經', subid: 278, scrollCount: 2, firstBookId: 3786, collectionId: 47, has0aPreface: true },
  { part: 207, title: '佛說大威燈光仙人問疑經', subid: 281, scrollCount: 1, firstBookId: 3788, collectionId: 47 },
  { part: 208, title: '一切法高王經', subid: 284, scrollCount: 1, firstBookId: 3789, collectionId: 47 },
  { part: 209, title: '佛說諸法勇王經', subid: 285, scrollCount: 1, firstBookId: 3790, collectionId: 47 },
  { part: 210, title: '順權方便經', subid: 288, scrollCount: 2, firstBookId: 3791, collectionId: 47 },
  { part: 211, title: '佛說樂瓔珞莊嚴方便經', subid: 291, scrollCount: 1, firstBookId: 3793, collectionId: 47 },
  { part: 212, title: '菩薩睒子經', subid: 292, scrollCount: 1, firstBookId: 3794, collectionId: 47 },
  { part: 213, title: '佛說睒子經', subid: 294, scrollCount: 1, firstBookId: 3795, collectionId: 47 },
  { part: 214, title: '佛說九色鹿經', subid: 295, scrollCount: 1, firstBookId: 3796, collectionId: 47 },
  { part: 215, title: '佛說太子沐魄經', subid: 297, scrollCount: 1, firstBookId: 3797, collectionId: 47 },
  { part: 216, title: '太子慕魄經', subid: 298, scrollCount: 1, firstBookId: 3798, collectionId: 47 },
  { part: 217, title: '無字寳篋經', subid: 299, scrollCount: 1, firstBookId: 3799, collectionId: 47 },
  { part: 218, title: '大乗離文字普光明藏經', subid: 300, scrollCount: 1, firstBookId: 3800, collectionId: 47 },
  { part: 219, title: '大乗徧照光明藏無字法門經', subid: 301, scrollCount: 1, firstBookId: 3801, collectionId: 47 },
  { part: 220, title: '佛說老女人經', subid: 302, scrollCount: 1, firstBookId: 3802, collectionId: 47 },
  { part: 221, title: '佛說老母經', subid: 303, scrollCount: 1, firstBookId: 3803, collectionId: 47 },
  { part: 222, title: '佛說老母女六英經', subid: 304, scrollCount: 1, firstBookId: 3804, collectionId: 47 },
  { part: 223, title: '佛說長者子制經', subid: 305, scrollCount: 1, firstBookId: 3805, collectionId: 47 },
  { part: 224, title: '佛說菩薩逝經', subid: 306, scrollCount: 1, firstBookId: 3806, collectionId: 47 },
  { part: 225, title: '佛說逝童子經', subid: 307, scrollCount: 1, firstBookId: 3807, collectionId: 47 },
  { part: 226, title: '佛說月光童子經', subid: 309, scrollCount: 1, firstBookId: 3808, collectionId: 47 },
  { part: 227, title: '佛說申日兒本經', subid: 310, scrollCount: 1, firstBookId: 3809, collectionId: 47 },
  { part: 228, title: '佛說德護長者經', subid: 311, scrollCount: 2, firstBookId: 3811, collectionId: 47, audioOverrides: { 1: 'https://w1.xianmijingzang.com/fojing/1/6/228/228_1.mp3', 2: 'https://mp3xm2.bohanjingzang.com/fojing/1/6/228/228_2.mp3' }, subidOverrides: { 2: 312 } },
  { part: 229, title: '佛說犢子經', subid: 312, scrollCount: 1, firstBookId: 3812, collectionId: 47 },
  { part: 230, title: '佛說乳光佛經', subid: 313, scrollCount: 1, firstBookId: 3813, collectionId: 47 },
  { part: 231, title: '佛說無垢賢女經', subid: 314, scrollCount: 1, firstBookId: 3814, collectionId: 47 },
  { part: 232, title: '佛說腹中女聽經', subid: 315, scrollCount: 1, firstBookId: 3815, collectionId: 47 },
  { part: 233, title: '佛說轉女身經', subid: 316, scrollCount: 1, firstBookId: 3816, collectionId: 47 },
  { part: 234, title: '文殊師利問菩提經', subid: 317, scrollCount: 1, firstBookId: 3817, collectionId: 47 },
  { part: 235, title: '伽耶山頂經', subid: 318, scrollCount: 1, firstBookId: 3818, collectionId: 47 },
  { part: 236, title: '佛說象頭精舍經', subid: 319, scrollCount: 1, firstBookId: 3819, collectionId: 47 },
  { part: 237, title: '大乗伽耶山頂經', subid: 320, scrollCount: 1, firstBookId: 3820, collectionId: 47 },
  { part: 238, title: '佛說決定緫持經', subid: 321, scrollCount: 1, firstBookId: 3821, collectionId: 47 },
  { part: 239, title: '佛說謗佛經', subid: 322, scrollCount: 1, firstBookId: 3822, collectionId: 47 },
  { part: 240, title: '大方等大雲經', subid: 323, scrollCount: 4, firstBookId: 3823, collectionId: 47 },
  { part: 241, title: '如來莊嚴智慧光明入一切佛境界經', subid: 325, scrollCount: 2, firstBookId: 3827, collectionId: 47 },
  { part: 242, title: '深宻解脫經', subid: 327, scrollCount: 6, firstBookId: 3829, collectionId: 47, has0aPreface: true },
  { part: 243, title: '解深宻經', subid: 329, scrollCount: 5, firstBookId: 3835, collectionId: 47 },
  { part: 244, title: '佛說諫王經', subid: 331, scrollCount: 1, firstBookId: 3840, collectionId: 47 },
  { part: 245, title: '如來示敎勝軍王經', subid: 333, scrollCount: 1, firstBookId: 3841, collectionId: 47 },
  { part: 246, title: '佛爲勝光天子說王法經', subid: 334, scrollCount: 1, firstBookId: 3842, collectionId: 47 },
  { part: 247, title: '寶積三昧文殊師利菩薩問法身經', subid: 335, scrollCount: 1, firstBookId: 3843, collectionId: 47 },
  { part: 248, title: '佛說濟諸方等學經', subid: 336, scrollCount: 1, firstBookId: 3844, collectionId: 47 },
  { part: 249, title: '大乗方廣緫持經', subid: 337, scrollCount: 1, firstBookId: 3845, collectionId: 47 },
  { part: 250, title: '太子須大拏經', subid: 338, scrollCount: 1, firstBookId: 3846, collectionId: 47 },
  { part: 251, title: '佛說如來智印經', subid: 339, scrollCount: 1, firstBookId: 3847, collectionId: 47 },
  { part: 252, title: '佛說慧印三昧經', subid: 340, scrollCount: 1, firstBookId: 3848, collectionId: 47 },
  { part: 253, title: '佛說無極寶三昧經', subid: 341, scrollCount: 2, firstBookId: 3849, collectionId: 47 },
  { part: 254, title: '寳如來三昧經', subid: 342, scrollCount: 2, firstBookId: 3851, collectionId: 47 },
  { part: 255, title: '無上依經', subid: 343, scrollCount: 2, firstBookId: 3853, collectionId: 47 },
  { part: 256, title: '佛說未曽有經', subid: 344, scrollCount: 1, firstBookId: 3855, collectionId: 47 },
  { part: 257, title: '佛說甚希有經', subid: 345, scrollCount: 1, firstBookId: 3856, collectionId: 47 },
  { part: 258, title: '佛說如來師子吼經', subid: 346, scrollCount: 1, firstBookId: 3857, collectionId: 47 },
  { part: 259, title: '佛說大方廣師子吼經', subid: 347, scrollCount: 1, firstBookId: 3858, collectionId: 47 },
  { part: 260, title: '佛說大乗百福相經', subid: 348, scrollCount: 1, firstBookId: 3859, collectionId: 47 },
  { part: 261, title: '佛說大乗百福莊嚴相經', subid: 349, scrollCount: 1, firstBookId: 3860, collectionId: 47 },
  { part: 262, title: '佛說大乗四法經', subid: 350, scrollCount: 1, firstBookId: 3861, collectionId: 47 },
  { part: 263, title: '佛說菩薩修行四法經', subid: 351, scrollCount: 1, firstBookId: 3862, collectionId: 47 },
  { part: 264, title: '佛說希有校量功德經', subid: 353, scrollCount: 1, firstBookId: 3863, collectionId: 47 },
  { part: 265, title: '佛說最無比經', subid: 354, scrollCount: 1, firstBookId: 3864, collectionId: 47 },
  { part: 266, title: '佛說前世三轉經', subid: 355, scrollCount: 1, firstBookId: 3865, collectionId: 47 },
  { part: 267, title: '佛說銀色女經', subid: 356, scrollCount: 1, firstBookId: 3866, collectionId: 47 },
  { part: 268, title: '佛說阿闍世王受決經', subid: 357, scrollCount: 1, firstBookId: 3867, collectionId: 47 },
  { part: 269, title: '採華違王上佛授決經', subid: 358, scrollCount: 1, firstBookId: 3868, collectionId: 47 },
  { part: 270, title: '佛說正恭敬經', subid: 359, scrollCount: 1, firstBookId: 3869, collectionId: 47 },
  { part: 271, title: '佛說善恭敬經', subid: 361, scrollCount: 1, firstBookId: 3870, collectionId: 47 },
  { part: 272, title: '稱讃大乗功德經', subid: 362, scrollCount: 1, firstBookId: 3871, collectionId: 47 },
  { part: 273, title: '妙法決定業障經', subid: 363, scrollCount: 1, firstBookId: 3872, collectionId: 47 },
  { part: 274, title: '佛說貝多樹下思惟十二因縁經', subid: 364, scrollCount: 1, firstBookId: 3873, collectionId: 47 },
  { part: 275, title: '佛說縁起聖道經', subid: 365, scrollCount: 1, firstBookId: 3874, collectionId: 47 },
  { part: 276, title: '佛說稻稈經', subid: 366, scrollCount: 1, firstBookId: 3875, collectionId: 47 },
  { part: 277, title: '佛說了本生死經', subid: 367, scrollCount: 1, firstBookId: 3876, collectionId: 47 },
  { part: 278, title: '佛說自誓三昧經', subid: 368, scrollCount: 1, firstBookId: 3877, collectionId: 47 },
  { part: 279, title: '如來獨證自誓三昧經', subid: 369, scrollCount: 1, firstBookId: 3878, collectionId: 47 },
  { part: 280, title: '佛說轉有經', subid: 370, scrollCount: 1, firstBookId: 3879, collectionId: 47 },
  { part: 281, title: '大方等修多羅王經', subid: 372, scrollCount: 1, firstBookId: 3880, collectionId: 47 },
  { part: 282, title: '佛說文殊師利廵行經', subid: 373, scrollCount: 1, firstBookId: 3881, collectionId: 47 },
  { part: 283, title: '佛說文殊尸利行經', subid: 374, scrollCount: 1, firstBookId: 3882, collectionId: 47 },
  { part: 284, title: '大乗造像功德經', subid: 376, scrollCount: 2, firstBookId: 3883, collectionId: 47 },
  { part: 285, title: '佛說作佛形像經', subid: 377, scrollCount: 1, firstBookId: 3885, collectionId: 47 },
  { part: 286, title: '佛說造立形像福報經', subid: 378, scrollCount: 1, firstBookId: 3886, collectionId: 47 },
  { part: 287, title: '佛說灌佛經', subid: 379, scrollCount: 1, firstBookId: 3887, collectionId: 47 },
  { part: 288, title: '佛說灌洗佛經', subid: 380, scrollCount: 1, firstBookId: 3888, collectionId: 47 },
  { part: 289, title: '佛說浴像功德經', subid: 381, scrollCount: 1, firstBookId: 3889, collectionId: 47 },
  { part: 290, title: '浴像功德經', subid: 382, scrollCount: 1, firstBookId: 3890, collectionId: 47 },
  { part: 291, title: '佛說校量數珠功德經', subid: 383, scrollCount: 1, firstBookId: 3891, collectionId: 47 },
  { part: 292, title: '曼殊室利呪藏中校量數珠功德經', subid: 384, scrollCount: 1, firstBookId: 3892, collectionId: 47 },
  { part: 293, title: '佛說龍施女經', subid: 385, scrollCount: 1, firstBookId: 3893, collectionId: 47 },
  { part: 294, title: '佛說龍施菩薩本起經', subid: 386, scrollCount: 1, firstBookId: 3894, collectionId: 47 },
  { part: 295, title: '佛說八吉祥神呪經', subid: 387, scrollCount: 1, firstBookId: 3895, collectionId: 47 },
  { part: 296, title: '佛說八陽神呪經', subid: 388, scrollCount: 1, firstBookId: 3896, collectionId: 47 },
  { part: 297, title: '佛說八吉祥經', subid: 389, scrollCount: 1, firstBookId: 3897, collectionId: 47 },
  { part: 298, title: '佛說八佛名號經', subid: 390, scrollCount: 1, firstBookId: 3898, collectionId: 47 },
  { part: 299, title: '佛說盂蘭盆經', subid: 391, scrollCount: 1, firstBookId: 3899, collectionId: 47 },
  { part: 300, title: '佛說報恩奉盆經', subid: 392, scrollCount: 1, firstBookId: 3900, collectionId: 47 },
  { part: 301, title: '佛說觀藥王藥上二菩薩經', subid: 393, scrollCount: 1, firstBookId: 3901, collectionId: 47 },
  { part: 302, title: '佛說大孔雀呪王經', subid: 394, scrollCount: 3, firstBookId: 3902, collectionId: 47 },
  { part: 303, title: '佛母大孔雀明王經', subid: 395, scrollCount: 4, firstBookId: 3905, collectionId: 47, has0aPreface: true },
  { part: 304, title: '佛說孔雀王呪經', subid: 396, scrollCount: 2, firstBookId: 3909, collectionId: 47 },
  { part: 305, title: '佛說大孔雀王神呪經', subid: 397, scrollCount: 1, firstBookId: 3911, collectionId: 47 },
  { part: 306, title: '佛說大孔雀王雜神呪經', subid: 398, scrollCount: 1, firstBookId: 3912, collectionId: 47 },
  { part: 307, title: '大金色孔雀王呪經', subid: 399, scrollCount: 1, firstBookId: 3913, collectionId: 47 },
  { part: 308, title: '佛說不空羂索呪經', subid: 400, scrollCount: 1, firstBookId: 3914, collectionId: 47 },
  { part: 309, title: '不空羂索心呪王經', subid: 401, scrollCount: 3, firstBookId: 3915, collectionId: 47 },
  { part: 310, title: '不空羂索陀羅尼經', subid: 402, scrollCount: 3, firstBookId: 3918, collectionId: 47, has0aPreface: true },
  { part: 311, title: '不空羂索呪心經', subid: 403, scrollCount: 1, firstBookId: 3921, collectionId: 47 },
  { part: 312, title: '不空羂索神呪心經', subid: 404, scrollCount: 2, firstBookId: 3922, collectionId: 47, has0aPreface: true },
  { part: 313, title: '不空羂索神變眞言經', subid: 405, scrollCount: 30, firstBookId: 3924, collectionId: 47 },
  { part: 314, title: '千眼千臂觀世音菩薩陀羅尼神呪經', subid: 406, scrollCount: 3, firstBookId: 3954, collectionId: 47, has0aPreface: true },
  { part: 315, title: '千手千眼觀世音菩薩姥陀羅尼身經', subid: 407, scrollCount: 1, firstBookId: 3957, collectionId: 47 },
  { part: 316, title: '千手千眼觀世音菩薩廣大圎滿無礙大悲心陀羅尼經', subid: 408, scrollCount: 2, firstBookId: 3958, collectionId: 47, has0aPreface: true },
  { part: 317, title: '觀世音菩薩祕密藏神呪經', subid: 409, scrollCount: 1, firstBookId: 3960, collectionId: 47 },
  { part: 318, title: '觀世音菩薩如意摩尼陀羅尼經', subid: 410, scrollCount: 1, firstBookId: 3961, collectionId: 47 },
  { part: 319, title: '觀自在菩薩如意心陀羅尼呪經', subid: 411, scrollCount: 1, firstBookId: 3962, collectionId: 47 },
  { part: 320, title: '如意輪陀羅尼經', subid: 412, scrollCount: 1, firstBookId: 3963, collectionId: 47 },
  { part: 321, title: '觀自在菩薩怛嚩多唎隨心陀羅尼經', subid: 413, scrollCount: 1, firstBookId: 3964, collectionId: 47 },
  { part: 322, title: '請觀世音菩薩消伏毒害陀羅尼呪經', subid: 414, scrollCount: 1, firstBookId: 3965, collectionId: 47 },
  { part: 323, title: '佛說十一面觀世音神呪經', subid: 415, scrollCount: 1, firstBookId: 3966, collectionId: 47 },
  { part: 324, title: '十一面神呪心經', subid: 416, scrollCount: 1, firstBookId: 3967, collectionId: 47 },
  { part: 325, title: '千轉陀羅尼觀世音菩薩呪經', subid: 418, scrollCount: 1, firstBookId: 3968, collectionId: 47 },
  { part: 326, title: '呪五首經', subid: 419, scrollCount: 1, firstBookId: 3969, collectionId: 47 },
  { part: 327, title: '六字神呪經', subid: 420, scrollCount: 1, firstBookId: 3970, collectionId: 47 },
  { part: 328, title: '呪三首經', subid: 421, scrollCount: 1, firstBookId: 3971, collectionId: 47 },
  { part: 329, title: '大方廣菩薩藏經中文殊師利根本一字陀羅尼法', subid: 422, scrollCount: 1, firstBookId: 3972, collectionId: 47 },
  { part: 330, title: '曼殊室利菩薩呪藏中一字呪王經', subid: 423, scrollCount: 1, firstBookId: 3973, collectionId: 47 },
  { part: 331, title: '十二佛名神呪校量功德除障滅罪經', subid: 424, scrollCount: 1, firstBookId: 3974, collectionId: 47 },
  { part: 332, title: '佛說稱讃如來功德神呪經', subid: 425, scrollCount: 1, firstBookId: 3975, collectionId: 47 },
  { part: 333, title: '華積陀羅尼神呪經', subid: 426, scrollCount: 1, firstBookId: 3976, collectionId: 47 },
  { part: 334, title: '師子奮迅菩薩所問經', subid: 427, scrollCount: 1, firstBookId: 3977, collectionId: 47 },
  { part: 335, title: '佛說華聚陀羅尼呪經', subid: 428, scrollCount: 1, firstBookId: 3978, collectionId: 47 },
  { part: 336, title: '六字呪王經', subid: 429, scrollCount: 1, firstBookId: 3979, collectionId: 47 },
  { part: 337, title: '六字神呪王經', subid: 430, scrollCount: 1, firstBookId: 3980, collectionId: 47 },
  { part: 338, title: '梵女首意經', subid: 431, scrollCount: 1, firstBookId: 3981, collectionId: 47 },
  { part: 339, title: '有德女所問大乗經', subid: 432, scrollCount: 1, firstBookId: 3982, collectionId: 47 },
  { part: 340, title: '佛說七俱胝佛母心大准提陀羅尼經', subid: 433, scrollCount: 1, firstBookId: 3983, collectionId: 47 },
  { part: 341, title: '佛說七俱胝佛母准提大明陀羅尼經', subid: 434, scrollCount: 1, firstBookId: 3984, collectionId: 47 },
  { part: 342, title: '七俱胝佛母所說准提陀羅尼經', subid: 435, scrollCount: 1, firstBookId: 3985, collectionId: 47 },
  { part: 343, title: '種種雜呪經', subid: 436, scrollCount: 1, firstBookId: 3986, collectionId: 47 },
  { part: 344, title: '佛頂尊勝陀羅尼經', subid: 437, scrollCount: 1, firstBookId: 3987, collectionId: 47 },
  { part: 345, title: '佛頂尊勝陀羅尼經', subid: 438, scrollCount: 3, firstBookId: 3988, collectionId: 47, has0aPreface: true, mergeFileCount: 3 },
  { part: 346, title: '佛說佛頂尊勝陀羅尼經', subid: 439, scrollCount: 1, firstBookId: 3991, collectionId: 47 },
  { part: 347, title: '最勝佛頂陀羅尼淨除業障經', subid: 440, scrollCount: 1, firstBookId: 3992, collectionId: 47 },
  { part: 348, title: '佛頂最勝陀羅尼經', subid: 441, scrollCount: 2, firstBookId: 3993, collectionId: 47, has0aPreface: true },
  { part: 349, title: '舍利弗陁羅尼經', subid: 442, scrollCount: 1, firstBookId: 3995, collectionId: 47 },
  { part: 350, title: '佛說無量門破魔陀羅尼經', subid: 443, scrollCount: 1, firstBookId: 3996, collectionId: 47 },
  { part: 351, title: '佛說無量門微宻持經', subid: 444, scrollCount: 1, firstBookId: 3997, collectionId: 47 },
  { part: 352, title: '佛說出生無量門持經', subid: 445, scrollCount: 1, firstBookId: 3998, collectionId: 47 },
  { part: 353, title: '阿難陀目佉尼訶離陀隣尼經', subid: 446, scrollCount: 1, firstBookId: 3999, collectionId: 47 },
  { part: 354, title: '阿難陀目佉尼訶離陀經', subid: 447, scrollCount: 1, firstBookId: 4000, collectionId: 47 },
  { part: 355, title: '佛說一向出生菩薩經', subid: 448, scrollCount: 1, firstBookId: 4001, collectionId: 47 },
  { part: 356, title: '出生無邊門陀羅尼經', subid: 449, scrollCount: 1, firstBookId: 4002, collectionId: 47 },
  { part: 357, title: '勝幢臂印陀羅尼經', subid: 450, scrollCount: 1, firstBookId: 4003, collectionId: 47 },
  { part: 358, title: '妙臂印幢陀羅尼經', subid: 451, scrollCount: 1, firstBookId: 4004, collectionId: 47 },
  { part: 359, title: '佛說陀羅尼集經', subid: 452, scrollCount: 14, firstBookId: 4005, collectionId: 47, has0aPreface: true },
  { part: 360, title: '佛說持句神呪經', subid: 453, scrollCount: 1, firstBookId: 4019, collectionId: 47 },
  { part: 361, title: '佛說陀鄰尼鉢經', subid: 454, scrollCount: 1, firstBookId: 4020, collectionId: 47 },
  { part: 362, title: '東方最勝燈王如來助護持世間神呪經', subid: 455, scrollCount: 1, firstBookId: 4021, collectionId: 47 },
  { part: 363, title: '如來方便善巧呪經', subid: 456, scrollCount: 1, firstBookId: 4022, collectionId: 47 },
  { part: 364, title: '虚空藏菩薩問七佛陀羅尼呪經', subid: 457, scrollCount: 1, firstBookId: 4023, collectionId: 47 },
  { part: 365, title: '善法方便陀羅尼呪經', subid: 458, scrollCount: 1, firstBookId: 4024, collectionId: 47 },
  { part: 366, title: '金剛秘密善門陀羅尼經', subid: 459, scrollCount: 1, firstBookId: 4025, collectionId: 47 },
  { part: 367, title: '護命法門神呪經', subid: 460, scrollCount: 1, firstBookId: 4026, collectionId: 47 },
  { part: 368, title: '金剛場陀羅尼經', subid: 461, scrollCount: 1, firstBookId: 4027, collectionId: 47 },
  { part: 369, title: '金剛上味陀羅尼經', subid: 462, scrollCount: 1, firstBookId: 4028, collectionId: 47 },
  { part: 370, title: '佛說無崖際緫持法門經', subid: 463, scrollCount: 1, firstBookId: 4029, collectionId: 47 },
  { part: 371, title: '尊勝菩薩所問一切諸法入無量法門陀羅尼經', subid: 464, scrollCount: 1, firstBookId: 4030, collectionId: 47 },
];

const CATALOG_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/47/subid/';

/**
 * Generate volumes from the scripture catalog.
 * Each scroll in each scripture becomes one claimable volume.
 */
const createCatalogVolumes = (): Volume[] => {
  const volumes: Volume[] = [];
  for (const entry of SCRIPTURE_CATALOG) {
    // Only merge 0a+0b/01 into scroll 1 if has0aPreface flag is set
    const has0aPreface = entry.has0aPreface === true;
    const mergeCount = entry.mergeFileCount || 2; // Default: merge 2 files (0a+0b), but can be 3 for (0a+0b+1)
    const effectiveScrolls = has0aPreface ? entry.scrollCount - (mergeCount - 1) : entry.scrollCount;

    for (let scroll = 1; scroll <= effectiveScrolls; scroll++) {
      // If has0aPreface: scroll 1 → firstBookId (0a), scroll S>1 → firstBookId + S
      // Otherwise: scroll N → firstBookId + (N-1)
      const bookId = has0aPreface
        ? (scroll === 1 ? entry.firstBookId : entry.firstBookId + scroll)
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

const prajna: Volume[] = createPrajnaVolumes();
const catalogVolumes: Volume[] = createCatalogVolumes();

export const INITIAL_VOLUMES: Volume[] = [...prajna, ...catalogVolumes];
