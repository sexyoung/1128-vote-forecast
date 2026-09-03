import { expect, it } from 'vite-plus/test';
import type { BattlegroundRanking } from '../api';
import { getCandidateMarkerPosition } from './CandidateRankingsPage';

it('places an interior candidate at the center of their share', () => {
  const candidates = [40, 35, 25].map((predictionCount, index) => ({
    id: String(index),
    name: String(index),
    photo: null,
    party: { id: 'IND', name: '無黨籍', color: '#888' },
    predictionCount,
    predictionPercent: predictionCount,
  })) satisfies BattlegroundRanking['candidates'];

  expect(getCandidateMarkerPosition(candidates, 1, 100)).toBeCloseTo(57.5);
});
