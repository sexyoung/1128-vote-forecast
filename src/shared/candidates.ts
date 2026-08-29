export const parties = [
  { id: 'DPP', name: '民主進步黨', shortName: '民進黨', color: '#1b9431' },
  { id: 'KMT', name: '中國國民黨', shortName: '國民黨', color: '#000099' },
  { id: 'TPP', name: '台灣民眾黨', shortName: '民眾黨', color: '#28c8c8' },
  { id: 'NPP', name: '時代力量', shortName: '時代力量', color: '#fbbe01' },
  { id: 'TSP', name: '台灣基進', shortName: '台灣基進', color: '#a73f24' },
  { id: 'PFP', name: '親民黨', shortName: '親民黨', color: '#ff6310' },
  { id: 'TSU', name: '台灣團結聯盟', shortName: '台聯', color: '#c69e6a' },
  { id: 'NP', name: '新黨', shortName: '新黨', color: '#ffda00' },
  { id: 'GPT', name: '台灣綠黨', shortName: '綠黨', color: '#00a650' },
  { id: 'SDP', name: '社會民主黨', shortName: '社民黨', color: '#ff69b4' },
  { id: 'CMG', name: '中華民族致公黨', shortName: '致公黨', color: '#800080' },
  { id: 'LABOR', name: '勞動黨', shortName: '勞動黨', color: '#dc143c' },
  { id: 'NPSU', name: '無黨團結聯盟', shortName: '無盟', color: '#c20f51' },
  { id: 'OBA', name: '小民參政歐巴桑聯盟', shortName: '歐巴桑聯盟', color: '#f4e6d3' },
  { id: 'TWP', name: '台灣工黨', shortName: '台灣工黨', color: '#cc0000' },
  { id: 'JRP', name: '司法改革黨', shortName: '司改黨', color: '#000080' },
  { id: 'ZSM', name: '正神名黨', shortName: '正神名黨', color: '#ffd700' },
  { id: 'MJP', name: '麻將黨', shortName: '麻將黨', color: '#3f8577' },
  // 不是政黨，只保留給既有地圖示意資料與日後無黨籍正式候選人。
  { id: 'IND', name: '無黨籍／其他', shortName: '無黨籍', color: '#8b8f8a' },
] as const;

export type PartyId = (typeof parties)[number]['id'];
export const candidateParties = parties.filter((party) => party.id !== 'IND');

export function getParty(id: PartyId) {
  return parties.find((party) => party.id === id) ?? parties[parties.length - 1];
}

const surnames =
  '陳林黃張李王吳劉蔡楊許鄭謝郭洪邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾彭游詹胡施沈余盧梁趙顏柯翁魏孫戴范方宋鄧杜傅侯曹薛丁卓馬董唐藍'.split(
    '',
  );
const givenNames =
  '志雅建怡俊淑文美明佳宗惠冠佩家欣柏宜承思哲心宇庭育嘉宏子維安翔芸廷凱雯瑞潔博慧昱瑋珮妤皓鈺彥寧宥涵品琪睿晴紹君立如政芳信玲孟慈元萱聖儀毅蓉'.split(
    '',
  );

function stableHash(value: string) {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fakeChineseName(contestId: string, index: number) {
  let value = (stableHash(contestId) + index) % (surnames.length * givenNames.length ** 2);
  const surname = surnames[value % surnames.length];
  value = Math.floor(value / surnames.length);
  return `${surname}${givenNames[value % givenNames.length]}${
    givenNames[Math.floor(value / givenNames.length) % givenNames.length]
  }`;
}

export function getMockCandidates(contest: { id: string; seatCount: number }) {
  const hash = stableHash(contest.id);
  const singleSeat = contest.seatCount === 1;
  const candidateCount = singleSeat
    ? 4 + (hash % 4)
    : contest.seatCount + Math.max(3, Math.ceil(contest.seatCount / 2));
  const orderedParties = [...candidateParties].sort(
    (left, right) =>
      stableHash(`${contest.id}:${left.id}`) - stableHash(`${contest.id}:${right.id}`),
  );
  const majorParties = candidateParties.slice(0, 3);
  const minorParties = candidateParties.slice(3);

  return Array.from({ length: candidateCount }, (_, index) => {
    const party = singleSeat
      ? orderedParties[index]
      : index % 3 === 2
        ? minorParties[(hash + Math.floor(index / 3)) % minorParties.length]
        : majorParties[(hash + index) % majorParties.length];
    return {
      id: `${contest.id}-CANDIDATE-${index + 1}`,
      name: fakeChineseName(contest.id, index),
      partyId: party.id,
      number: index + 1,
    };
  });
}
