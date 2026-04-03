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
  // Parts 538-674: 小乘阿含部 (collection 47)
  { part: 538, title: '佛說甘露經陀羅尼', subid: 631, scrollCount: 60, firstBookId: 4415, collectionId: 47 },
  { part: 539, title: '大陀羅尼末法中一字心呪經', subid: 632, scrollCount: 50, firstBookId: 4475, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 540, title: '佛說甚深大廻向經', subid: 633, scrollCount: 50, firstBookId: 4526, collectionId: 47 },
  { part: 541, title: '中阿含經', subid: 634, scrollCount: 22, firstBookId: 4576, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 542, title: '増壹阿含經', subid: 635, scrollCount: 20, firstBookId: 4599, collectionId: 47 },
  { part: 543, title: '雜阿含經', subid: 636, scrollCount: 1, firstBookId: 4619, collectionId: 47 },
  { part: 544, title: '佛說長阿含經', subid: 637, scrollCount: 2, firstBookId: 4620, collectionId: 47 },
  { part: 545, title: '别譯雜阿含經', subid: 638, scrollCount: 10, firstBookId: 4622, collectionId: 47 },
  { part: 546, title: '雜阿含經', subid: 639, scrollCount: 10, firstBookId: 4632, collectionId: 47 },
  { part: 547, title: '長阿含十報法經', subid: 640, scrollCount: 6, firstBookId: 4642, collectionId: 47 },
  { part: 548, title: '起世因本經', subid: 641, scrollCount: 2, firstBookId: 4648, collectionId: 47 },
  { part: 549, title: '起世經', subid: 642, scrollCount: 1, firstBookId: 4650, collectionId: 47, has0aPreface: true, mergeFileCount: 2 },
  { part: 550, title: '佛說樓炭經', subid: 643, scrollCount: 1, firstBookId: 4652, collectionId: 47 },
  { part: 551, title: '佛般泥洹經', subid: 644, scrollCount: 1, firstBookId: 4653, collectionId: 47 },
  { part: 552, title: '佛說人本欲生經', subid: 645, scrollCount: 2, firstBookId: 4654, collectionId: 47 },
  { part: 553, title: '佛說梵網六十二見經', subid: 646, scrollCount: 1, firstBookId: 4656, collectionId: 47 },
  { part: 554, title: '佛說尸迦羅越六方禮經', subid: 647, scrollCount: 1, firstBookId: 4657, collectionId: 47 },
  { part: 555, title: '正法念處經', subid: 648, scrollCount: 1, firstBookId: 4658, collectionId: 47 },
  { part: 556, title: '中本起經', subid: 649, scrollCount: 1, firstBookId: 4659, collectionId: 47 },
  { part: 557, title: '佛說七知經', subid: 650, scrollCount: 1, firstBookId: 4660, collectionId: 47 },
  { part: 558, title: '佛說鹹水喻經', subid: 651, scrollCount: 1, firstBookId: 4661, collectionId: 47 },
  { part: 559, title: '佛說一切流攝守因經', subid: 652, scrollCount: 1, firstBookId: 4662, collectionId: 47 },
  { part: 560, title: '佛說閻羅王五天使者經', subid: 653, scrollCount: 1, firstBookId: 4663, collectionId: 47 },
  { part: 561, title: '佛說鐵城泥犂經', subid: 654, scrollCount: 1, firstBookId: 4664, collectionId: 47 },
  { part: 562, title: '佛說古來世時經', subid: 655, scrollCount: 1, firstBookId: 4665, collectionId: 47 },
  { part: 563, title: '佛說阿那律八念經', subid: 656, scrollCount: 1, firstBookId: 4666, collectionId: 47 },
  { part: 564, title: '佛說離睡經', subid: 657, scrollCount: 1, firstBookId: 4667, collectionId: 47 },
  { part: 565, title: '佛說是法非法經', subid: 658, scrollCount: 1, firstBookId: 4668, collectionId: 47 },
  { part: 566, title: '佛說樂想經', subid: 659, scrollCount: 1, firstBookId: 4669, collectionId: 47 },
  { part: 567, title: '佛說漏分布經', subid: 660, scrollCount: 1, firstBookId: 4670, collectionId: 47 },
  { part: 568, title: '佛說阿耨颰經', subid: 661, scrollCount: 1, firstBookId: 4671, collectionId: 47 },
  { part: 569, title: '佛說求欲經', subid: 662, scrollCount: 1, firstBookId: 4672, collectionId: 47 },
  { part: 570, title: '佛說受歳經', subid: 663, scrollCount: 1, firstBookId: 4673, collectionId: 47 },
  { part: 571, title: '佛說梵志計水淨經', subid: 664, scrollCount: 1, firstBookId: 4674, collectionId: 47 },
  { part: 572, title: '佛說伏婬經', subid: 665, scrollCount: 1, firstBookId: 4675, collectionId: 47 },
  { part: 573, title: '佛說魔嬈亂經', subid: 666, scrollCount: 1, firstBookId: 4676, collectionId: 47 },
  { part: 574, title: '佛說弊魔試目連', subid: 667, scrollCount: 1, firstBookId: 4677, collectionId: 47 },
  { part: 575, title: '佛說泥犂經', subid: 668, scrollCount: 1, firstBookId: 4678, collectionId: 47 },
  { part: 576, title: '佛說優婆夷墮舍迦經', subid: 669, scrollCount: 1, firstBookId: 4679, collectionId: 47 },
  { part: 577, title: '佛說齋經', subid: 670, scrollCount: 1, firstBookId: 4680, collectionId: 47 },
  { part: 578, title: '佛說苦隂經', subid: 671, scrollCount: 1, firstBookId: 4681, collectionId: 47 },
  { part: 579, title: '佛說苦隂因事經', subid: 672, scrollCount: 1, firstBookId: 4682, collectionId: 47 },
  { part: 580, title: '佛說釋摩男本經', subid: 673, scrollCount: 1, firstBookId: 4683, collectionId: 47 },
  { part: 581, title: '佛說鞞摩肅經', subid: 674, scrollCount: 1, firstBookId: 4684, collectionId: 47 },
  { part: 582, title: '佛說婆羅門子命終愛念不離經', subid: 675, scrollCount: 1, firstBookId: 4685, collectionId: 47 },
  { part: 583, title: '佛說十支居士八城人經', subid: 676, scrollCount: 1, firstBookId: 4686, collectionId: 47 },
  { part: 584, title: '佛說邪見經', subid: 677, scrollCount: 1, firstBookId: 4687, collectionId: 47 },
  { part: 585, title: '佛說箭喻經', subid: 678, scrollCount: 1, firstBookId: 4688, collectionId: 47 },
  { part: 586, title: '佛說普法義經', subid: 679, scrollCount: 1, firstBookId: 4689, collectionId: 47 },
  { part: 587, title: '大方等大集经', subid: 680, scrollCount: 1, firstBookId: 4690, collectionId: 47 },
  { part: 588, title: '大乘大方等日藏经', subid: 681, scrollCount: 1, firstBookId: 4691, collectionId: 47 },
  { part: 589, title: '大方等大集月藏经', subid: 682, scrollCount: 1, firstBookId: 4692, collectionId: 47 },
  { part: 590, title: '大乘大集地藏十轮经', subid: 683, scrollCount: 1, firstBookId: 4693, collectionId: 47 },
  { part: 591, title: '佛说大方广十轮经', subid: 684, scrollCount: 1, firstBookId: 4694, collectionId: 47 },
  { part: 592, title: '大集须弥藏经', subid: 685, scrollCount: 1, firstBookId: 4695, collectionId: 47 },
  { part: 593, title: '虚空孕菩萨经', subid: 686, scrollCount: 1, firstBookId: 4696, collectionId: 47 },
  { part: 594, title: '虚空藏菩萨经', subid: 687, scrollCount: 1, firstBookId: 4697, collectionId: 47 },
  { part: 595, title: '虚空藏菩萨神咒经', subid: 688, scrollCount: 1, firstBookId: 4698, collectionId: 47 },
  { part: 596, title: '宝星陀罗尼经', subid: 689, scrollCount: 1, firstBookId: 4699, collectionId: 47 },
  { part: 597, title: '佛說廣義法門經', subid: 690, scrollCount: 1, firstBookId: 4700, collectionId: 47 },
  { part: 598, title: '佛說戒德香經', subid: 691, scrollCount: 1, firstBookId: 4701, collectionId: 47 },
  { part: 599, title: '佛說四人出現世間經', subid: 692, scrollCount: 1, firstBookId: 4702, collectionId: 47 },
  { part: 600, title: '佛說諸法本經', subid: 693, scrollCount: 1, firstBookId: 4703, collectionId: 47 },
  { part: 601, title: '佛說瞿曇彌記果經', subid: 694, scrollCount: 1, firstBookId: 4704, collectionId: 47 },
  { part: 602, title: '佛說梵志阿颰經', subid: 695, scrollCount: 1, firstBookId: 4705, collectionId: 47 },
  { part: 603, title: '佛說寂志果經', subid: 696, scrollCount: 1, firstBookId: 4706, collectionId: 47 },
  { part: 604, title: '佛說賴吒和羅經', subid: 697, scrollCount: 1, firstBookId: 4707, collectionId: 47 },
  { part: 605, title: '佛說善生子經', subid: 698, scrollCount: 1, firstBookId: 4708, collectionId: 47 },
  { part: 606, title: '佛說數經', subid: 699, scrollCount: 1, firstBookId: 4709, collectionId: 47 },
  { part: 607, title: '佛說梵志頞波羅延問種尊經', subid: 700, scrollCount: 1, firstBookId: 4710, collectionId: 47 },
  { part: 608, title: '佛說四諦經', subid: 701, scrollCount: 1, firstBookId: 4711, collectionId: 47 },
  { part: 609, title: '佛說恒水經', subid: 702, scrollCount: 1, firstBookId: 4712, collectionId: 47 },
  { part: 610, title: '佛說瞻婆比丘經', subid: 703, scrollCount: 1, firstBookId: 4713, collectionId: 47 },
  { part: 611, title: '佛說本相倚致經', subid: 704, scrollCount: 1, firstBookId: 4714, collectionId: 47 },
  { part: 612, title: '佛說縁本致經', subid: 705, scrollCount: 1, firstBookId: 4715, collectionId: 47 },
  { part: 613, title: '佛說頂生王故事經', subid: 706, scrollCount: 1, firstBookId: 4716, collectionId: 47 },
  { part: 614, title: '佛說文陀竭王經', subid: 707, scrollCount: 1, firstBookId: 4717, collectionId: 47 },
  { part: 615, title: '三歸五戒慈心猒離功德經', subid: 708, scrollCount: 1, firstBookId: 4718, collectionId: 47 },
  { part: 616, title: '佛說須達經', subid: 709, scrollCount: 1, firstBookId: 4719, collectionId: 47 },
  { part: 617, title: '佛爲黄竹園老婆羅門說學經', subid: 710, scrollCount: 1, firstBookId: 4720, collectionId: 47 },
  { part: 618, title: '佛說梵摩喻經', subid: 711, scrollCount: 1, firstBookId: 4721, collectionId: 47 },
  { part: 619, title: '佛說尊上經', subid: 712, scrollCount: 1, firstBookId: 4722, collectionId: 47 },
  { part: 620, title: '佛說鸚鵡經', subid: 713, scrollCount: 1, firstBookId: 4723, collectionId: 47 },
  { part: 621, title: '佛說兜調經', subid: 714, scrollCount: 1, firstBookId: 4724, collectionId: 47 },
  { part: 622, title: '佛說意經', subid: 715, scrollCount: 1, firstBookId: 4725, collectionId: 47 },
  { part: 623, title: '佛說應法經', subid: 716, scrollCount: 1, firstBookId: 4726, collectionId: 47 },
  { part: 624, title: '佛說波斯匿王太后崩塵土坌身經', subid: 717, scrollCount: 1, firstBookId: 4727, collectionId: 47 },
  { part: 625, title: '須摩提女經', subid: 718, scrollCount: 1, firstBookId: 4728, collectionId: 47 },
  { part: 626, title: '佛說三摩竭經', subid: 719, scrollCount: 1, firstBookId: 4729, collectionId: 47 },
  { part: 627, title: '佛說婆羅門避死經', subid: 720, scrollCount: 1, firstBookId: 4730, collectionId: 47 },
  { part: 628, title: '食施獲五福報經', subid: 721, scrollCount: 1, firstBookId: 4731, collectionId: 47 },
  { part: 629, title: '頻毗娑羅王詣佛供養經', subid: 722, scrollCount: 1, firstBookId: 4732, collectionId: 47 },
  { part: 630, title: '佛說長者子六過出家', subid: 723, scrollCount: 1, firstBookId: 4733, collectionId: 47 },
  { part: 631, title: '佛說鴦崛摩經', subid: 724, scrollCount: 1, firstBookId: 4734, collectionId: 47 },
  { part: 632, title: '佛說鴦崛髻經', subid: 725, scrollCount: 1, firstBookId: 4735, collectionId: 47 },
  { part: 633, title: '佛說力士移山經', subid: 726, scrollCount: 1, firstBookId: 4736, collectionId: 47 },
  { part: 634, title: '佛說四未曽有法經', subid: 727, scrollCount: 1, firstBookId: 4737, collectionId: 47 },
  { part: 635, title: '佛說舍利弗目揵連遊四衢經', subid: 728, scrollCount: 1, firstBookId: 4738, collectionId: 47 },
  { part: 636, title: '七佛父母姓字經', subid: 729, scrollCount: 1, firstBookId: 4739, collectionId: 47 },
  { part: 637, title: '佛說放牛經', subid: 730, scrollCount: 1, firstBookId: 4740, collectionId: 47 },
  { part: 638, title: '縁起經', subid: 731, scrollCount: 1, firstBookId: 4741, collectionId: 47 },
  { part: 639, title: '佛說十一想思念如來經', subid: 732, scrollCount: 1, firstBookId: 4742, collectionId: 47 },
  { part: 640, title: '佛說四泥犂經', subid: 733, scrollCount: 1, firstBookId: 4743, collectionId: 47 },
  { part: 641, title: '舍衞國王夢見十事經', subid: 734, scrollCount: 2, firstBookId: 4744, collectionId: 47 },
  { part: 642, title: '佛說國王不黎先尼十夢經', subid: 735, scrollCount: 1, firstBookId: 4746, collectionId: 47 },
  { part: 643, title: '阿難同學經', subid: 736, scrollCount: 2, firstBookId: 4747, collectionId: 47 },
  { part: 644, title: '五藴皆空經', subid: 737, scrollCount: 2, firstBookId: 4749, collectionId: 47 },
  { part: 645, title: '阿難問事佛吉凶經', subid: 738, scrollCount: 1, firstBookId: 4751, collectionId: 47 },
  { part: 646, title: '慢法經', subid: 739, scrollCount: 1, firstBookId: 4752, collectionId: 47 },
  { part: 647, title: '阿難分别經', subid: 740, scrollCount: 1, firstBookId: 4753, collectionId: 47 },
  { part: 648, title: '五母子經', subid: 741, scrollCount: 1, firstBookId: 4754, collectionId: 47 },
  { part: 649, title: '沙彌羅經', subid: 742, scrollCount: 1, firstBookId: 4755, collectionId: 47 },
  { part: 650, title: '玉耶經', subid: 743, scrollCount: 1, firstBookId: 4756, collectionId: 47 },
  { part: 651, title: '玉耶女經', subid: 744, scrollCount: 1, firstBookId: 4757, collectionId: 47 },
  { part: 652, title: '阿遫逹經', subid: 745, scrollCount: 1, firstBookId: 4758, collectionId: 47 },
  { part: 653, title: '摩鄧女經', subid: 746, scrollCount: 1, firstBookId: 4759, collectionId: 47 },
  { part: 654, title: '摩登女解形中六事經', subid: 747, scrollCount: 1, firstBookId: 4760, collectionId: 47 },
  { part: 655, title: '摩登伽經', subid: 748, scrollCount: 1, firstBookId: 4761, collectionId: 47 },
  { part: 656, title: '舍頭諫經', subid: 749, scrollCount: 1, firstBookId: 4762, collectionId: 47 },
  { part: 657, title: '治禪病秘要經', subid: 750, scrollCount: 1, firstBookId: 4763, collectionId: 47 },
  { part: 658, title: '佛說七處三觀經', subid: 751, scrollCount: 1, firstBookId: 4764, collectionId: 47 },
  { part: 659, title: '阿那邠邸化七子經', subid: 752, scrollCount: 1, firstBookId: 4765, collectionId: 47 },
  { part: 660, title: '佛說大愛道般涅槃經', subid: 753, scrollCount: 2, firstBookId: 4766, collectionId: 47 },
  { part: 661, title: '佛母般泥洹經', subid: 754, scrollCount: 2, firstBookId: 4768, collectionId: 47 },
  { part: 662, title: '佛說聖法印經', subid: 755, scrollCount: 4, firstBookId: 4770, collectionId: 47 },
  { part: 663, title: '五隂譬喻經', subid: 756, scrollCount: 1, firstBookId: 4774, collectionId: 47 },
  { part: 664, title: '佛說水沫所漂經', subid: 757, scrollCount: 1, firstBookId: 4775, collectionId: 47 },
  { part: 665, title: '佛說不自守意經', subid: 758, scrollCount: 5, firstBookId: 4776, collectionId: 47 },
  { part: 666, title: '佛說滿願子經', subid: 759, scrollCount: 1, firstBookId: 4781, collectionId: 47 },
  { part: 667, title: '轉法輪經', subid: 760, scrollCount: 1, firstBookId: 4782, collectionId: 47 },
  { part: 668, title: '佛說三轉法輪經', subid: 761, scrollCount: 1, firstBookId: 4783, collectionId: 47 },
  { part: 669, title: '佛說八正道經', subid: 762, scrollCount: 1, firstBookId: 4784, collectionId: 47 },
  { part: 670, title: '難提釋經', subid: 763, scrollCount: 2, firstBookId: 4785, collectionId: 47 },
  { part: 671, title: '佛說馬有三相經', subid: 764, scrollCount: 1, firstBookId: 4787, collectionId: 47 },
  { part: 672, title: '佛說馬有八態譬人經', subid: 765, scrollCount: 1, firstBookId: 4788, collectionId: 47 },
  { part: 673, title: '佛說相應相可經', subid: 766, scrollCount: 1, firstBookId: 4789, collectionId: 47 },
  { part: 674, title: '修行本起經', subid: 767, scrollCount: 1, firstBookId: 4790, collectionId: 47, has0aPreface: true, mergeFileCount: 4 },
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
