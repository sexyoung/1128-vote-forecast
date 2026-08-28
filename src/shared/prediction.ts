/**
 * 前端與伺服器共用的預測規則。放在 shared 是因為兩邊都必須得到同一個答案：
 * 畫面讓人選候選人、伺服器卻只收政黨（或反過來），送出的東西就會被拒絕。
 */

export type ContestType = 'EXECUTIVE' | 'COUNCIL' | 'TOWNSHIP' | 'REPRESENTATIVE' | 'VILLAGE';

export type PredictionMode = 'party' | 'candidate';

/**
 * 正式候選人名單公告前就先用（黨籍示意）候選人而不是政黨的選舉。
 * 只有一席的選舉（縣市長、鄉鎮市長、村里長）也算：那種選舉大家記得的是人，
 * 面板只寫「民進黨 52%」等於沒說到重點。
 */
export function usesPreAnnouncementCandidateTargets(type: ContestType, seats: number) {
  return type === 'COUNCIL' || type === 'REPRESENTATIVE' || seats === 1;
}

/** 這一場要選候選人還是政黨。`candidatesPublished` 是中選會名單有沒有進來。 */
export function getPredictionMode(
  type: ContestType,
  seats: number,
  candidatesPublished: boolean,
): PredictionMode {
  return usesPreAnnouncementCandidateTargets(type, seats) || candidatesPublished
    ? 'candidate'
    : 'party';
}
