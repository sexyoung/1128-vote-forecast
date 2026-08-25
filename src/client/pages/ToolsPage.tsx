import { FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { createForecast, getForecasts } from '../api';

const tools = [
  'Vite+',
  'React + TypeScript',
  'Tailwind CSS（僅保留整合，未套用樣式）',
  'React Router',
  'TanStack Query',
  'Hono',
  'Prisma + PostgreSQL',
];

export function ToolsPage() {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [probability, setProbability] = useState(50);
  const forecasts = useQuery({ queryKey: ['forecasts'], queryFn: getForecasts });
  const create = useMutation({
    mutationFn: createForecast,
    onSuccess: async () => {
      setTitle('');
      setDescription('');
      setProbability(50);
      await queryClient.invalidateQueries({ queryKey: ['forecasts'] });
    },
  });

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    create.mutate({ title, description, probability });
  }

  return (
    <main>
      <h1>Tools</h1>
      <ul>
        {tools.map((tool) => (
          <li key={tool}>{tool}</li>
        ))}
      </ul>

      <h2>新增預測</h2>
      <form onSubmit={handleSubmit}>
        <p>
          <label>
            標題
            <input
              required
              maxLength={120}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            說明
            <textarea
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>
        </p>
        <p>
          <label>
            機率
            <input
              type="number"
              min="0"
              max="100"
              value={probability}
              onChange={(event) => setProbability(Number(event.target.value))}
            />
          </label>
        </p>
        <button type="submit" disabled={create.isPending}>
          {create.isPending ? '儲存中…' : '新增'}
        </button>
      </form>
      {create.error && <p>{create.error.message}</p>}

      <h2>預測資料</h2>
      {forecasts.isLoading && <p>讀取中…</p>}
      {forecasts.error && <p>{forecasts.error.message}</p>}
      <ul>
        {forecasts.data?.map((forecast) => (
          <li key={forecast.id}>
            {forecast.title}：{forecast.probability}%
            {forecast.description && `（${forecast.description}）`}
          </li>
        ))}
      </ul>
    </main>
  );
}
