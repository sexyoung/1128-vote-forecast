import { expect, it } from 'vite-plus/test';
import { publishPrediction, subscribeToPredictions } from './prediction-events';

it('fans prediction events out until unsubscribed', () => {
  const received: string[] = [];
  const unsubscribe = subscribeToPredictions(({ contestId }) => received.push(contestId));
  publishPrediction({ contestId: 'TPE-EXECUTIVE-1', jurisdictionId: 'TPE', bubbles: [] });
  unsubscribe();
  publishPrediction({ contestId: 'NTP-EXECUTIVE-1', jurisdictionId: 'NTP', bubbles: [] });
  expect(received).toEqual(['TPE-EXECUTIVE-1']);
});
