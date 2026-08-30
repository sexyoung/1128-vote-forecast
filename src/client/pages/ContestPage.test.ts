import { describe, expect, it } from 'vite-plus/test';
import { buildSocialShareUrl, forecastAsideTitle } from './ContestPage';

describe('contest forecast prompt', () => {
  it('distinguishes no prediction, a partial prediction, and a full prediction', () => {
    expect(forecastAsideTitle(0, 5)).toBe('你還沒有預測這一區');
    expect(forecastAsideTitle(3, 5)).toBe('你還可以補齊這區的預測');
    expect(forecastAsideTitle(5, 5)).toBe('你已完成這區的預測');
  });
});

describe('contest social sharing', () => {
  it('creates a fresh timestamped contest URL for every platform', () => {
    const page = 'https://vote.example/contest/TPE-EXECUTIVE-1?tab=comments';
    const timestamp = 1_788_076_800_000;

    const facebook = new URL(buildSocialShareUrl('facebook', page, '分享文字', timestamp));
    const line = new URL(buildSocialShareUrl('line', page, '分享文字', timestamp));
    const threads = new URL(buildSocialShareUrl('threads', page, '分享文字', timestamp));
    const twitter = new URL(buildSocialShareUrl('twitter', page, '分享文字', timestamp));
    const sharedPage = `https://vote.example/contest/TPE-EXECUTIVE-1?t=${timestamp}`;

    expect(facebook.searchParams.get('u')).toBe(sharedPage);
    expect(line.searchParams.get('url')).toBe(sharedPage);
    expect(threads.searchParams.get('text')).toContain(sharedPage);
    expect(twitter.searchParams.get('url')).toBe(sharedPage);
  });
});
