import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@festie/shared';
import { WeatherData, WeatherPoint } from '@festie/shared/types';
import { cn } from '@/lib/utils';
import {
  Cloud,
  CloudRain,
  CloudLightning,
  Sun,
  CloudSun,
  Snowflake,
  Wind,
  Droplets,
  CloudOff,
} from 'lucide-react';

interface WeatherWidgetProps {
  festivalId: string;
}

function getWeatherIcon(condition: string): React.ReactNode {
  const lower = condition.toLowerCase();
  if (lower.includes('storm') || lower.includes('thunder'))
    return <CloudLightning className="w-8 h-8 text-purple-400" />;
  if (lower.includes('rain') || lower.includes('shower'))
    return <CloudRain className="w-8 h-8 text-blue-400" />;
  if (lower.includes('snow') || lower.includes('sleet'))
    return <Snowflake className="w-8 h-8 text-sky-300" />;
  if (lower.includes('partly') || lower.includes('mostly'))
    return <CloudSun className="w-8 h-8 text-amber-300" />;
  if (lower.includes('cloud') || lower.includes('overcast'))
    return <Cloud className="w-8 h-8 text-gray-400" />;
  if (lower.includes('sun') || lower.includes('clear'))
    return <Sun className="w-8 h-8 text-yellow-400" />;
  return <Cloud className="w-8 h-8 text-gray-400" />;
}

function formatDayLabel(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return dateStr;
  }
}

function DayCard({ point }: { point: WeatherPoint }) {
  return (
    <div
      className={cn(
        'flex-shrink-0 w-32 p-3 rounded-lg text-center',
        'bg-bg-card border border-border',
        'snap-start',
      )}
    >
      <div className="text-xs text-text-secondary mb-2 truncate">
        {formatDayLabel(point.date)}
      </div>

      <div className="flex justify-center mb-2">
        {getWeatherIcon(point.condition)}
      </div>

      <div className="text-lg font-semibold text-text-primary">
        {Math.round(point.temperature)}&deg;
      </div>

      <div className="text-xs text-text-muted truncate mt-1">
        {point.condition}
      </div>

      <div className="flex items-center justify-center gap-3 mt-2">
        <span className="flex items-center gap-0.5 text-xs text-text-secondary">
          <Droplets className="w-3 h-3" />
          {point.humidity}%
        </span>
        <span className="flex items-center gap-0.5 text-xs text-text-secondary">
          <Wind className="w-3 h-3" />
          {point.windSpeed}
        </span>
      </div>
    </div>
  );
}

export default function WeatherWidget({ festivalId }: WeatherWidgetProps) {
  const {
    data: weatherData,
    isLoading,
    isError,
  } = useQuery<WeatherData>({
    queryKey: ['weather', festivalId],
    queryFn: () => api.get<WeatherData>(`/api/v1/weather/${festivalId}`),
    enabled: !!festivalId,
    staleTime: 1000 * 60 * 15, // 15 min
    retry: 1,
  });

  if (isLoading) {
    return (
      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="flex-shrink-0 w-32 h-36 rounded-lg skeleton"
          />
        ))}
      </div>
    );
  }

  if (isError || !weatherData || !weatherData.forecast || weatherData.forecast.length === 0) {
    return (
      <div className="mx-4 p-4 rounded-lg bg-bg-card border border-border flex items-center gap-3">
        <CloudOff className="w-5 h-5 text-text-muted flex-shrink-0" />
        <span className="text-sm text-text-muted">Weather unavailable</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-4">
        <h3 className="text-sm font-semibold text-text-primary">Forecast</h3>
        <span className="text-xs text-text-muted">
          Updated {new Date(weatherData.updatedAt).toLocaleTimeString(undefined, {
            hour: 'numeric',
            minute: '2-digit',
          })}
        </span>
      </div>

      <div className="flex gap-3 overflow-x-auto px-4 pb-2 snap-x snap-mandatory scrollbar-hide">
        {weatherData.forecast.map((point, index) => (
          <DayCard key={point.date || index} point={point} />
        ))}
      </div>
    </div>
  );
}
