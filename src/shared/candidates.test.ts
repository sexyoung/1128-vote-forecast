import { describe, expect, it } from 'vite-plus/test';
import { candidateParties, getMockCandidates, getParty } from './candidates';

describe('fake candidates', () => {
  it('uses the supplied major-party colors', () => {
    expect(getParty('DPP').color).toBe('#1b9431');
    expect(getParty('KMT').color).toBe('#000099');
  });

  it('uses the requested 18 parties', () => {
    expect(candidateParties.map(({ name }) => name)).toEqual([
      '民主進步黨',
      '中國國民黨',
      '台灣民眾黨',
      '時代力量',
      '台灣基進',
      '親民黨',
      '台灣團結聯盟',
      '新黨',
      '台灣綠黨',
      '社會民主黨',
      '中華民族致公黨',
      '勞動黨',
      '無黨團結聯盟',
      '小民參政歐巴桑聯盟',
      '台灣工黨',
      '司法改革黨',
      '正神名黨',
      '麻將黨',
    ]);
  });

  it('nominates at most one person per party in single-seat contests', () => {
    const candidates = getMockCandidates({ id: 'TPE-EXECUTIVE-1', seatCount: 1 });
    expect(new Set(candidates.map(({ partyId }) => partyId)).size).toBe(candidates.length);
    expect(new Set(candidates.map(({ name }) => name)).size).toBe(candidates.length);
  });

  it('allows repeated parties in multi-seat contests', () => {
    const candidates = getMockCandidates({ id: 'TPE-COUNCIL-6', seatCount: 13 });
    expect(candidates).toHaveLength(20);
    expect(new Set(candidates.map(({ partyId }) => partyId)).size).toBeLessThan(candidates.length);
  });
});
