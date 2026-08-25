export type Forecast = {
  id: number;
  title: string;
  description: string | null;
  probability: number;
  createdAt: string;
  updatedAt: string;
};

export type ForecastInput = Pick<Forecast, 'title' | 'probability'> & {
  description?: string;
};
