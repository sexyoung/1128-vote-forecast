import { getCouncilDistricts } from './council-districts';

export type PartyId = 'KMT' | 'DPP' | 'TPP' | 'IND';

export type ElectionView = 'EXECUTIVE' | 'COUNCIL' | 'TOWNSHIP' | 'REPRESENTATIVE' | 'VILLAGE';

export type Jurisdiction = {
  id: string;
  name: string;
  kind: 'municipality' | 'county' | 'city';
  gridArea: string;
  leader: PartyId;
  percentage: number;
  forecasts: number;
};

export type Contest = {
  id: string;
  jurisdictionId: string;
  name: string;
  area: string;
  seatCount: number;
  view: ElectionView;
  leader: PartyId;
  percentage: number;
  forecasts: number;
};

export const parties = [
  { id: 'KMT' as const, name: '中國國民黨', shortName: '國民黨', color: '#3f69b1' },
  { id: 'DPP' as const, name: '民主進步黨', shortName: '民進黨', color: '#2c8a64' },
  { id: 'TPP' as const, name: '台灣民眾黨', shortName: '民眾黨', color: '#28a5a5' },
  { id: 'IND' as const, name: '無黨籍／其他', shortName: '無黨籍', color: '#b9813f' },
];

export const electionViews: { id: ElectionView; label: string; shortLabel: string }[] = [
  { id: 'EXECUTIVE', label: '縣市長', shortLabel: '首長' },
  { id: 'COUNCIL', label: '議員', shortLabel: '議員' },
  { id: 'TOWNSHIP', label: '鄉鎮市長', shortLabel: '鄉鎮市長' },
  { id: 'REPRESENTATIVE', label: '代表', shortLabel: '代表' },
  { id: 'VILLAGE', label: '村里長', shortLabel: '村里長' },
];

export const jurisdictions: Jurisdiction[] = [
  {
    id: 'LIE',
    name: '連江縣',
    kind: 'county',
    gridArea: 'lie',
    leader: 'KMT',
    percentage: 48,
    forecasts: 182,
  },
  {
    id: 'KIN',
    name: '金門縣',
    kind: 'county',
    gridArea: 'kin',
    leader: 'KMT',
    percentage: 54,
    forecasts: 346,
  },
  {
    id: 'PEN',
    name: '澎湖縣',
    kind: 'county',
    gridArea: 'pen',
    leader: 'IND',
    percentage: 39,
    forecasts: 219,
  },
  {
    id: 'TPE',
    name: '臺北市',
    kind: 'municipality',
    gridArea: 'tpe',
    leader: 'DPP',
    percentage: 42,
    forecasts: 1284,
  },
  {
    id: 'NTP',
    name: '新北市',
    kind: 'municipality',
    gridArea: 'ntp',
    leader: 'KMT',
    percentage: 44,
    forecasts: 1532,
  },
  {
    id: 'KEE',
    name: '基隆市',
    kind: 'city',
    gridArea: 'kee',
    leader: 'DPP',
    percentage: 41,
    forecasts: 474,
  },
  {
    id: 'TAO',
    name: '桃園市',
    kind: 'municipality',
    gridArea: 'tao',
    leader: 'KMT',
    percentage: 43,
    forecasts: 1102,
  },
  {
    id: 'HSZ',
    name: '新竹市',
    kind: 'city',
    gridArea: 'hsz',
    leader: 'TPP',
    percentage: 38,
    forecasts: 766,
  },
  {
    id: 'HSQ',
    name: '新竹縣',
    kind: 'county',
    gridArea: 'hsq',
    leader: 'KMT',
    percentage: 46,
    forecasts: 621,
  },
  {
    id: 'ILA',
    name: '宜蘭縣',
    kind: 'county',
    gridArea: 'ila',
    leader: 'DPP',
    percentage: 45,
    forecasts: 538,
  },
  {
    id: 'MIA',
    name: '苗栗縣',
    kind: 'county',
    gridArea: 'mia',
    leader: 'KMT',
    percentage: 49,
    forecasts: 587,
  },
  {
    id: 'TXG',
    name: '臺中市',
    kind: 'municipality',
    gridArea: 'txg',
    leader: 'KMT',
    percentage: 41,
    forecasts: 1398,
  },
  {
    id: 'CHA',
    name: '彰化縣',
    kind: 'county',
    gridArea: 'cha',
    leader: 'DPP',
    percentage: 40,
    forecasts: 748,
  },
  {
    id: 'NAN',
    name: '南投縣',
    kind: 'county',
    gridArea: 'nan',
    leader: 'KMT',
    percentage: 47,
    forecasts: 434,
  },
  {
    id: 'YUN',
    name: '雲林縣',
    kind: 'county',
    gridArea: 'yun',
    leader: 'DPP',
    percentage: 48,
    forecasts: 603,
  },
  {
    id: 'CYI',
    name: '嘉義市',
    kind: 'city',
    gridArea: 'cyi',
    leader: 'DPP',
    percentage: 43,
    forecasts: 318,
  },
  {
    id: 'CYQ',
    name: '嘉義縣',
    kind: 'county',
    gridArea: 'cyq',
    leader: 'DPP',
    percentage: 51,
    forecasts: 462,
  },
  {
    id: 'TNN',
    name: '臺南市',
    kind: 'municipality',
    gridArea: 'tnn',
    leader: 'DPP',
    percentage: 52,
    forecasts: 1209,
  },
  {
    id: 'HUA',
    name: '花蓮縣',
    kind: 'county',
    gridArea: 'hua',
    leader: 'KMT',
    percentage: 46,
    forecasts: 391,
  },
  {
    id: 'KHH',
    name: '高雄市',
    kind: 'municipality',
    gridArea: 'khh',
    leader: 'DPP',
    percentage: 50,
    forecasts: 1456,
  },
  {
    id: 'PIF',
    name: '屏東縣',
    kind: 'county',
    gridArea: 'pif',
    leader: 'DPP',
    percentage: 49,
    forecasts: 672,
  },
  {
    id: 'TTT',
    name: '臺東縣',
    kind: 'county',
    gridArea: 'ttt',
    leader: 'IND',
    percentage: 36,
    forecasts: 309,
  },
];

const viewSettings: Record<
  Exclude<ElectionView, 'EXECUTIVE' | 'COUNCIL'>,
  { count: number; seats: number; noun: string }
> = {
  TOWNSHIP: { count: 5, seats: 1, noun: '鄉鎮市長' },
  REPRESENTATIVE: { count: 5, seats: 5, noun: '代表' },
  VILLAGE: { count: 8, seats: 1, noun: '村里長' },
};

export function getParty(id: PartyId) {
  return parties.find((party) => party.id === id) ?? parties[3];
}

export function getJurisdiction(id?: string) {
  return jurisdictions.find((jurisdiction) => jurisdiction.id === id) ?? jurisdictions[3];
}

export function getContests(jurisdiction: Jurisdiction, view: ElectionView): Contest[] {
  if (view === 'EXECUTIVE') {
    return [
      {
        id: `${jurisdiction.id}-EXECUTIVE-1`,
        jurisdictionId: jurisdiction.id,
        name: `${jurisdiction.name}長`,
        area: `${jurisdiction.name}全境`,
        seatCount: 1,
        view,
        leader: jurisdiction.leader,
        percentage: jurisdiction.percentage,
        forecasts: jurisdiction.forecasts,
      },
    ];
  }

  if (view === 'COUNCIL') {
    return getCouncilDistricts(jurisdiction.id).map((district, index) => {
      const party = parties[(jurisdictions.indexOf(jurisdiction) + index) % parties.length];
      return {
        id: district.id,
        jurisdictionId: jurisdiction.id,
        name: `議員第 ${district.number} 選舉區`,
        area: district.area,
        seatCount: district.seats,
        view,
        leader: party.id,
        percentage: 34 + ((index * 3 + jurisdiction.forecasts) % 16),
        forecasts: 186 + ((index * 137 + jurisdiction.forecasts) % 900),
      };
    });
  }

  const setting = viewSettings[view];
  return Array.from({ length: setting.count }, (_, index) => {
    const party = parties[(jurisdictions.indexOf(jurisdiction) + index) % parties.length];
    return {
      id: `${jurisdiction.id}-${view}-${index + 1}`,
      jurisdictionId: jurisdiction.id,
      name: `${setting.noun}第 ${index + 1} 選舉區`,
      area: `示意範圍 ${String.fromCharCode(65 + index)}、${String.fromCharCode(66 + index)}`,
      seatCount: setting.seats === 1 ? 1 : Math.max(2, setting.seats + ((index % 3) - 1)),
      view,
      leader: party.id,
      percentage: 34 + ((index * 3 + jurisdiction.forecasts) % 16),
      forecasts: 186 + ((index * 137 + jurisdiction.forecasts) % 900),
    };
  });
}

export function findContest(contestId?: string) {
  const jurisdictionId = contestId?.split('-')[0];
  const jurisdiction = getJurisdiction(jurisdictionId);
  for (const view of electionViews) {
    const contest = getContests(jurisdiction, view.id).find((item) => item.id === contestId);
    if (contest) return { contest, jurisdiction };
  }
  return { contest: getContests(jurisdiction, 'EXECUTIVE')[0], jurisdiction };
}

export function getMockCandidates(contest: Contest) {
  const partyOrder: PartyId[] = ['KMT', 'DPP', 'TPP', 'IND'];
  // 只有一席的選舉（縣市長、鄉鎮市長、村里長）每個政黨只會推一個人，名單就是
  // 四個政黨各一位，也不必編號；多席次才會出現同黨多人。
  const singleSeat = contest.seatCount === 1;
  const candidateCount = singleSeat ? partyOrder.length : Math.max(4, contest.seatCount + 4);
  const partyCounts: Record<PartyId, number> = { KMT: 0, DPP: 0, TPP: 0, IND: 0 };

  return Array.from({ length: candidateCount }, (_, index) => {
    const partyId = partyOrder[index % partyOrder.length];
    const shortName = getParty(partyId).shortName;
    partyCounts[partyId] += 1;
    return {
      id: `${contest.id}-CANDIDATE-${index + 1}`,
      name: singleSeat ? `${shortName}候選人` : `${shortName}候選人 ${partyCounts[partyId]}`,
      partyId,
      number: index + 1,
    };
  });
}
