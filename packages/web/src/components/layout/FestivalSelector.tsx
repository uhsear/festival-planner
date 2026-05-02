import React from 'react';
import { useFestivalStore } from '@festie/shared';

export default function FestivalSelector() {
  const festivals = useFestivalStore((state) => state.festivals);
  const currentFestival = useFestivalStore((state) => state.currentFestival);
  const selectFestival = useFestivalStore((state) => state.selectFestival);
  const isLoading = useFestivalStore((state) => state.isLoading);

  const handleChange = async (e: React.ChangeEvent<HTMLSelectElement>) => {
    const id = e.target.value;
    if (!id) return;
    await selectFestival(id);
  };

  return (
    <>
      <label
        htmlFor="festival-select-input"
        style={{
          fontSize: '12px',
          color: 'var(--text-secondary)',
          marginRight: '6px',
          display: 'inline-block',
          fontWeight: 600,
        }}
      >
        Festival:
      </label>
      <select
        id="festival-select-input"
        className="festival-select"
        data-testid="festival-select"
        value={currentFestival?.id || ''}
        onChange={handleChange}
        disabled={isLoading}
      >
        <option value="">Select Festival</option>
        {festivals.map((festival) => (
          <option key={festival.id} value={festival.id}>
            {festival.name}
          </option>
        ))}
      </select>
    </>
  );
}
