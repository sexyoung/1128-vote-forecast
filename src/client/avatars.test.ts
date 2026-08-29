import { describe, expect, it } from 'vite-plus/test';
import { avatarFileName, avatarUrl, toAvatarSlug } from './avatars';

describe('candidate avatar file names', () => {
  // 這幾個例子跟 public/avatars/README.md 裡列的是同一組，兩邊要一起改。
  it('builds the documented name', () => {
    expect(avatarFileName('TPE-EXECUTIVE-1', 'DPP', 'Chen Mei-Ling')).toBe(
      'TPE-EXECUTIVE-1-DPP-chen-mei-ling.jpg',
    );
    expect(avatarFileName('NTP-COUNCIL-2', 'KMT', 'Lin Chih-Hao')).toBe(
      'NTP-COUNCIL-2-KMT-lin-chih-hao.jpg',
    );
    expect(avatarFileName('town-10002040-TOWNSHIP', 'IND', 'Huang Ta-Wei', 'webp')).toBe(
      'town-10002040-TOWNSHIP-IND-huang-ta-wei.webp',
    );
  });

  it('normalises spacing and punctuation out of the name', () => {
    expect(toAvatarSlug('  Puma   Shen ')).toBe('puma-shen');
    expect(toAvatarSlug("Ko Wen-je's")).toBe('ko-wen-jes');
    expect(toAvatarSlug('Chiang_Wan-an')).toBe('chiang-wan-an');
  });

  // 名單公告前 getMockCandidates() 只有假中文姓名，沒有拼音。
  // 回 null 而不是猜一個檔名，封面才會安靜地退回色塊，不會每張卡送一個 404。
  it('has no url until the name is known', () => {
    expect(avatarUrl('TPE-EXECUTIVE-1', 'DPP')).toBeNull();
    expect(avatarUrl('TPE-EXECUTIVE-1', 'DPP', '')).toBeNull();
    expect(avatarUrl('TPE-EXECUTIVE-1', 'DPP', '陳怡君')).toBeNull();
    expect(avatarUrl('TPE-EXECUTIVE-1', 'DPP', 'Puma Shen')).toBe(
      '/avatars/TPE-EXECUTIVE-1-DPP-puma-shen.jpg',
    );
  });
});
