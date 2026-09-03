export type PredictionEvent = {
  contestId: string;
  jurisdictionId: string;
  bubbles: { color: string; photo: string; targetId: string }[];
};

type Listener = (event: PredictionEvent) => void;
const listeners = new Set<Listener>();

// ponytail: process-local fanout; replace with Redis pub/sub when production runs multiple instances.
export function publishPrediction(event: PredictionEvent) {
  for (const listener of listeners) listener(event);
}

export function subscribeToPredictions(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
