import { Volume, VolumeStatus } from './types';

/**
 * Scripture Catalog: Parts 675-776
 * Collection ID: 50
 * From xianmijingzang.com
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
  { part: 675, title: '正法念處經', subid: 648, scrollCount: 71, firstBookId: 4794, collectionId: 50, has0aPreface: true },
  { part: 676, title: '佛本行集經', subid: 782, scrollCount: 60, firstBookId: 4865, collectionId: 50 },
  { part: 677, title: '佛說大安般守意經', subid: 783, scrollCount: 3, firstBookId: 4925, collectionId: 50, has0aPreface: true },
  { part: 678, title: '佛說罵意經', subid: 784, scrollCount: 1, firstBookId: 4928, collectionId: 50 },
  { part: 679, title: '禪行法想經', subid: 785, scrollCount: 1, firstBookId: 4929, collectionId: 50 },
  { part: 680, title: '佛說處處經', subid: 786, scrollCount: 1, firstBookId: 4930, collectionId: 50 },
  { part: 681, title: '佛說分别善惡所起經', subid: 787, scrollCount: 1, firstBookId: 4931, collectionId: 50 },
  { part: 682, title: '佛說出家縁經', subid: 788, scrollCount: 1, firstBookId: 4932, collectionId: 50 },
  { part: 683, title: '佛說阿含正行經', subid: 789, scrollCount: 1, firstBookId: 4933, collectionId: 50 },
  { part: 684, title: '佛說十八泥犂經', subid: 790, scrollCount: 1, firstBookId: 4934, collectionId: 50 },
  { part: 685, title: '佛說法受塵經', subid: 791, scrollCount: 1, firstBookId: 4935, collectionId: 50 },
  { part: 686, title: '佛說進學經', subid: 792, scrollCount: 1, firstBookId: 4936, collectionId: 50 },
  { part: 687, title: '佛說得道梯隥錫杖經', subid: 793, scrollCount: 1, firstBookId: 4937, collectionId: 50 },
  { part: 688, title: '佛說貧窮老公經', subid: 794, scrollCount: 1, firstBookId: 4938, collectionId: 50 },
  { part: 689, title: '須摩提長者經', subid: 795, scrollCount: 1, firstBookId: 4939, collectionId: 50 },
  { part: 690, title: '長者懊惱三處經', subid: 796, scrollCount: 1, firstBookId: 4940, collectionId: 50 },
  { part: 691, title: '犍陀國王經', subid: 797, scrollCount: 1, firstBookId: 4941, collectionId: 50 },
  { part: 692, title: '阿難四事經', subid: 798, scrollCount: 1, firstBookId: 4942, collectionId: 50 },
  { part: 693, title: '分别經', subid: 799, scrollCount: 1, firstBookId: 4943, collectionId: 50 },
  { part: 694, title: '未生怨經', subid: 800, scrollCount: 1, firstBookId: 4944, collectionId: 50 },
  { part: 695, title: '四願經', subid: 801, scrollCount: 1, firstBookId: 4945, collectionId: 50 },
  { part: 696, title: '猘狗經', subid: 802, scrollCount: 1, firstBookId: 4946, collectionId: 50 },
  { part: 697, title: '八關齋經', subid: 803, scrollCount: 1, firstBookId: 4947, collectionId: 50 },
  { part: 698, title: '孝子經', subid: 804, scrollCount: 1, firstBookId: 4948, collectionId: 50 },
  { part: 699, title: '黒氏梵志經', subid: 805, scrollCount: 1, firstBookId: 4949, collectionId: 50 },
  { part: 700, title: '阿鳩留經', subid: 806, scrollCount: 1, firstBookId: 4950, collectionId: 50 },
  { part: 701, title: '佛爲阿支羅迦葉自化作苦經', subid: 807, scrollCount: 1, firstBookId: 4951, collectionId: 50 },
  { part: 702, title: '佛說罪業報應教化地獄經', subid: 808, scrollCount: 1, firstBookId: 4952, collectionId: 50 },
  { part: 703, title: '佛說龍王兄弟經', subid: 809, scrollCount: 1, firstBookId: 4953, collectionId: 50 },
  { part: 704, title: '佛說長者音恱經', subid: 810, scrollCount: 1, firstBookId: 4954, collectionId: 50 },
  { part: 705, title: '佛說七女經', subid: 811, scrollCount: 1, firstBookId: 4955, collectionId: 50 },
  { part: 706, title: '佛說八師經', subid: 812, scrollCount: 1, firstBookId: 4956, collectionId: 50 },
  { part: 707, title: '佛說越難經', subid: 813, scrollCount: 1, firstBookId: 4957, collectionId: 50 },
  { part: 708, title: '佛說所欲致患經', subid: 814, scrollCount: 1, firstBookId: 4958, collectionId: 50 },
  { part: 709, title: '阿闍世王問五逆經', subid: 815, scrollCount: 1, firstBookId: 4959, collectionId: 50 },
  { part: 710, title: '本事經', subid: 816, scrollCount: 7, firstBookId: 4960, collectionId: 50 },
  { part: 711, title: '佛說中心經', subid: 817, scrollCount: 1, firstBookId: 4967, collectionId: 50 },
  { part: 712, title: '佛說見正經', subid: 818, scrollCount: 1, firstBookId: 4968, collectionId: 50 },
  { part: 713, title: '佛說大魚事經', subid: 819, scrollCount: 1, firstBookId: 4969, collectionId: 50 },
  { part: 714, title: '佛說阿難七夢經', subid: 820, scrollCount: 1, firstBookId: 4970, collectionId: 50 },
  { part: 715, title: '佛說呵鵰阿那含經', subid: 821, scrollCount: 1, firstBookId: 4971, collectionId: 50 },
  { part: 716, title: '佛說燈指因縁經', subid: 822, scrollCount: 1, firstBookId: 4972, collectionId: 50 },
  { part: 717, title: '佛說婦人遇辜經', subid: 823, scrollCount: 1, firstBookId: 4973, collectionId: 50 },
  { part: 718, title: '佛說四天王經', subid: 824, scrollCount: 1, firstBookId: 4974, collectionId: 50 },
  { part: 719, title: '佛說摩訶迦葉度貧母經', subid: 825, scrollCount: 1, firstBookId: 4975, collectionId: 50 },
  { part: 720, title: '佛說禪行三十七品經', subid: 826, scrollCount: 1, firstBookId: 4976, collectionId: 50 },
  { part: 721, title: '比丘避女惡名欲自殺經', subid: 827, scrollCount: 1, firstBookId: 4977, collectionId: 50 },
  { part: 722, title: '佛說身觀經', subid: 828, scrollCount: 1, firstBookId: 4978, collectionId: 50 },
  { part: 723, title: '佛說無常經', subid: 829, scrollCount: 1, firstBookId: 4979, collectionId: 50 },
  { part: 724, title: '佛說八無暇有暇經', subid: 830, scrollCount: 1, firstBookId: 4980, collectionId: 50 },
  { part: 725, title: '五百弟子自說本起經', subid: 831, scrollCount: 1, firstBookId: 4981, collectionId: 50 },
  { part: 726, title: '佛說五苦章句經', subid: 832, scrollCount: 1, firstBookId: 4982, collectionId: 50 },
  { part: 727, title: '佛說堅意經', subid: 833, scrollCount: 1, firstBookId: 4983, collectionId: 50 },
  { part: 728, title: '佛說淨飯王般涅槃經', subid: 834, scrollCount: 1, firstBookId: 4984, collectionId: 50 },
  { part: 729, title: '佛說興起行經', subid: 835, scrollCount: 3, firstBookId: 4985, collectionId: 50, has0aPreface: true },
  { part: 730, title: '長爪梵志請問經', subid: 836, scrollCount: 1, firstBookId: 4988, collectionId: 50 },
  { part: 731, title: '佛說譬喻經', subid: 837, scrollCount: 1, firstBookId: 4989, collectionId: 50 },
  { part: 732, title: '佛說比丘聽施經', subid: 838, scrollCount: 1, firstBookId: 4990, collectionId: 50 },
  { part: 733, title: '佛說畧敎誡經', subid: 839, scrollCount: 1, firstBookId: 4991, collectionId: 50 },
  { part: 734, title: '佛說療痔病經', subid: 840, scrollCount: 1, firstBookId: 4992, collectionId: 50 },
  { part: 735, title: '佛說業報差别經', subid: 841, scrollCount: 1, firstBookId: 4993, collectionId: 50 },
  { part: 736, title: '佛說十二品生死經', subid: 842, scrollCount: 1, firstBookId: 4994, collectionId: 50 },
  { part: 737, title: '佛說輪轉五道罪福報應經', subid: 843, scrollCount: 1, firstBookId: 4995, collectionId: 50 },
  { part: 738, title: '佛說五無返復經', subid: 844, scrollCount: 2, firstBookId: 4996, collectionId: 50 },
  { part: 739, title: '佛說佛大僧大經', subid: 846, scrollCount: 1, firstBookId: 4998, collectionId: 50 },
  { part: 740, title: '佛說大迦葉本經', subid: 847, scrollCount: 1, firstBookId: 4999, collectionId: 50 },
  { part: 741, title: '佛說四自侵經', subid: 848, scrollCount: 1, firstBookId: 5000, collectionId: 50 },
  { part: 742, title: '佛說羅云忍辱經', subid: 849, scrollCount: 1, firstBookId: 5001, collectionId: 50 },
  { part: 743, title: '佛爲年少比丘說正事經', subid: 850, scrollCount: 1, firstBookId: 5002, collectionId: 50 },
  { part: 744, title: '佛說沙曷比丘功德經', subid: 851, scrollCount: 1, firstBookId: 5003, collectionId: 50 },
  { part: 745, title: '佛說時非時經', subid: 852, scrollCount: 1, firstBookId: 5004, collectionId: 50 },
  { part: 746, title: '佛說自愛經', subid: 853, scrollCount: 1, firstBookId: 5005, collectionId: 50 },
  { part: 747, title: '佛說賢者五福德經', subid: 854, scrollCount: 1, firstBookId: 5006, collectionId: 50 },
  { part: 748, title: '天請問經', subid: 855, scrollCount: 1, firstBookId: 5007, collectionId: 50 },
  { part: 749, title: '佛說護淨經', subid: 856, scrollCount: 1, firstBookId: 5008, collectionId: 50 },
  { part: 750, title: '佛說木槵經', subid: 857, scrollCount: 1, firstBookId: 5009, collectionId: 50 },
  { part: 751, title: '佛說無上處經', subid: 858, scrollCount: 1, firstBookId: 5010, collectionId: 50 },
  { part: 752, title: '盧至長者因縁經', subid: 859, scrollCount: 1, firstBookId: 5011, collectionId: 50 },
  { part: 753, title: '佛說普達王經', subid: 860, scrollCount: 1, firstBookId: 5012, collectionId: 50 },
  { part: 754, title: '佛說鬼子母經', subid: 861, scrollCount: 1, firstBookId: 5013, collectionId: 50 },
  { part: 755, title: '佛說梵摩難國王經', subid: 862, scrollCount: 1, firstBookId: 5014, collectionId: 50 },
  { part: 756, title: '佛說孫多耶致經', subid: 863, scrollCount: 1, firstBookId: 5015, collectionId: 50 },
  { part: 757, title: '佛說父母恩難報經', subid: 864, scrollCount: 1, firstBookId: 5016, collectionId: 50 },
  { part: 758, title: '佛說新歳經', subid: 865, scrollCount: 1, firstBookId: 5017, collectionId: 50 },
  { part: 759, title: '佛說群牛譬經', subid: 866, scrollCount: 1, firstBookId: 5018, collectionId: 50 },
  { part: 760, title: '佛說九横經', subid: 867, scrollCount: 1, firstBookId: 5019, collectionId: 50 },
  { part: 761, title: '佛說五恐怖世經', subid: 868, scrollCount: 1, firstBookId: 5020, collectionId: 50 },
  { part: 762, title: '佛說弟子死復生經', subid: 869, scrollCount: 1, firstBookId: 5021, collectionId: 50 },
  { part: 763, title: '佛說懈怠耕者經', subid: 870, scrollCount: 1, firstBookId: 5022, collectionId: 50 },
  { part: 764, title: '佛說辯意長者子所問經', subid: 871, scrollCount: 1, firstBookId: 5023, collectionId: 50 },
  { part: 765, title: '無垢優婆夷問經', subid: 872, scrollCount: 1, firstBookId: 5024, collectionId: 50 },
  { part: 766, title: '佛說耶祇經', subid: 873, scrollCount: 1, firstBookId: 5025, collectionId: 50 },
  { part: 767, title: '佛說末羅王經', subid: 874, scrollCount: 1, firstBookId: 5026, collectionId: 50 },
  { part: 768, title: '佛說摩達國王經', subid: 875, scrollCount: 1, firstBookId: 5027, collectionId: 50 },
  { part: 769, title: '佛說旃陀越國王經', subid: 876, scrollCount: 1, firstBookId: 5028, collectionId: 50 },
  { part: 770, title: '佛說五王經', subid: 877, scrollCount: 1, firstBookId: 5029, collectionId: 50 },
  { part: 771, title: '佛說出家功德經', subid: 878, scrollCount: 1, firstBookId: 5030, collectionId: 50 },
  { part: 772, title: '佛說栴檀樹經', subid: 879, scrollCount: 1, firstBookId: 5031, collectionId: 50 },
  { part: 773, title: '佛說頞多和多耆經', subid: 880, scrollCount: 1, firstBookId: 5032, collectionId: 50 },
  { part: 774, title: '禪秘要法經', subid: 881, scrollCount: 3, firstBookId: 5033, collectionId: 50 },
  { part: 775, title: '隂持入經', subid: 882, scrollCount: 2, firstBookId: 5036, collectionId: 50 },
  { part: 776, title: '佛說因縁僧護經', subid: 883, scrollCount: 1, firstBookId: 5038, collectionId: 50 }
];

const CATALOG_BASE_URL = 'https://w1.xianmijingzang.com/wap/tripitaka/id/50/subid/';

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

export const INITIAL_VOLUMES: Volume[] = createCatalogVolumes();
