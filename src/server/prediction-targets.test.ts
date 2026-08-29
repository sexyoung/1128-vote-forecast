import { expect, it } from 'vite-plus/test';
import { getRegisteredContest } from './contest-registry.js';
import { getPredictionTargets } from './prediction-targets.js';

it('does not invent candidates missing from the database', () => {
  const contest = getRegisteredContest('TPE-EXECUTIVE-1');
  if (!contest) throw new Error('測試選區不存在。');

  expect(getPredictionTargets({ ...contest, id: 'MISSING-CONTEST' })).toEqual([]);
});
