/**
 * Weather Module — festival weather forecast display
 * Uses Open-Meteo (free, no API key) via backend proxy
 * Copyright (c) 2026 Asir Khan. All rights reserved.
 */
import { S } from './state.js?v=1776342458439';
import { h } from './dom.js?v=1776342458439';

let _api;

export function initWeather(deps) {
  _api = deps.api;
}

// WMO weather code → icon + label
const WMO_CODES = {
  0: ['☀️', 'Clear'], 1: ['🌤️', 'Mostly Clear'], 2: ['⛅', 'Partly Cloudy'], 3: ['☁️', 'Overcast'],
  45: ['🌫️', 'Fog'], 48: ['🌫️', 'Rime Fog'],
  51: ['🌧️', 'Light Drizzle'], 53: ['🌧️', 'Drizzle'], 55: ['🌧️', 'Heavy Drizzle'],
  61: ['🌧️', 'Light Rain'], 63: ['🌧️', 'Rain'], 65: ['🌧️', 'Heavy Rain'],
  71: ['🌨️', 'Light Snow'], 73: ['🌨️', 'Snow'], 75: ['🌨️', 'Heavy Snow'],
  80: ['🌦️', 'Light Showers'], 81: ['🌦️', 'Showers'], 82: ['🌦️', 'Heavy Showers'],
  95: ['⛈️', 'Thunderstorm'], 96: ['⛈️', 'T-Storm + Hail'], 99: ['⛈️', 'Heavy T-Storm'],
};

function getWeatherIcon(code) { return (WMO_CODES[code] || ['🌡️', 'Unknown'])[0]; }
function getWeatherLabel(code) { return (WMO_CODES[code] || ['', 'Unknown'])[1]; }

// Convert Celsius to Fahrenheit
function cToF(c) { return Math.round(c * 9 / 5 + 32); }

// ── Cache ─────────────────────────────────────────────────────
let _weatherCache = {};  // festivalId → { data, loadedAt }
const CACHE_TTL = 15 * 60 * 1000; // 15 min client-side

export async function loadWeather(festivalId) {
  if (!festivalId) return null;
  const cached = _weatherCache[festivalId];
  if (cached && Date.now() - cached.loadedAt < CACHE_TTL) return cached.data;

  try {
    const data = await _api('/weather/' + festivalId);
    if (data.available) {
      _weatherCache[festivalId] = { data, loadedAt: Date.now() };
    }
    return data;
  } catch { return { available: false, reason: 'Failed to load weather' }; }
}

// ── Weather widget (compact, for festival detail page) ────────
export function renderWeatherWidget(weatherData) {
  if (!weatherData?.available) return null;

  const container = h('div', { className: 'weather-widget' });
  container.appendChild(h('div', { className: 'weather-header' }, '🌤️ Weather Forecast'));

  const grid = h('div', { className: 'weather-grid' });
  const { dates, maxTemp, minTemp, precipChance, weatherCode } = weatherData.daily;

  // Show up to 5 days
  const count = Math.min(dates.length, 5);
  for (let i = 0; i < count; i++) {
    const day = h('div', { className: 'weather-day' });
    const dateStr = new Date(dates[i] + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
    day.appendChild(h('div', { className: 'weather-date' }, dateStr));
    day.appendChild(h('div', { className: 'weather-icon' }, getWeatherIcon(weatherCode[i])));
    day.appendChild(h('div', { className: 'weather-temp' },
      cToF(maxTemp[i]) + '° / ' + cToF(minTemp[i]) + '°'));
    if (precipChance[i] > 20) {
      day.appendChild(h('div', { className: 'weather-precip' }, '💧 ' + precipChance[i] + '%'));
    }
    day.appendChild(h('div', { className: 'weather-label' }, getWeatherLabel(weatherCode[i])));
    grid.appendChild(day);
  }
  container.appendChild(grid);
  return container;
}

// ── Hourly breakdown for current day ──────────────────────────
export function renderHourlyWeather(weatherData, dayDate) {
  if (!weatherData?.available || !dayDate) return null;
  const { times, temp, precipChance, weatherCode } = weatherData.hourly;

  // Filter to hours matching the selected day (festival hours: 12pm-3am)
  const dayPrefix = dayDate; // YYYY-MM-DD
  const hourlyForDay = [];
  for (let i = 0; i < times.length; i++) {
    if (times[i].startsWith(dayPrefix)) {
      const hour = parseInt(times[i].slice(11, 13), 10);
      if (hour >= 12) { // Afternoon/evening only
        hourlyForDay.push({ hour, temp: temp[i], precip: precipChance[i], code: weatherCode[i] });
      }
    }
  }
  // Also check next day's early hours (midnight-3am)
  const nextDay = new Date(dayDate + 'T12:00:00');
  nextDay.setDate(nextDay.getDate() + 1);
  const nextPrefix = nextDay.toISOString().slice(0, 10);
  for (let i = 0; i < times.length; i++) {
    if (times[i].startsWith(nextPrefix)) {
      const hour = parseInt(times[i].slice(11, 13), 10);
      if (hour <= 3) hourlyForDay.push({ hour: hour + 24, temp: temp[i], precip: precipChance[i], code: weatherCode[i] });
    }
  }

  if (hourlyForDay.length === 0) return null;

  const strip = h('div', { className: 'weather-hourly' });
  hourlyForDay.forEach(({ hour, temp: t, precip, code }) => {
    const hh = hour % 24;
    const label = hh === 0 ? '12a' : hh < 12 ? hh + 'a' : hh === 12 ? '12p' : (hh - 12) + 'p';
    const cell = h('div', { className: 'weather-hour' });
    cell.appendChild(h('span', { className: 'weather-hour-time' }, label));
    cell.appendChild(h('span', { className: 'weather-hour-icon' }, getWeatherIcon(code)));
    cell.appendChild(h('span', { className: 'weather-hour-temp' }, cToF(t) + '°'));
    if (precip > 20) cell.appendChild(h('span', { className: 'weather-hour-precip' }, precip + '%'));
    strip.appendChild(cell);
  });
  return strip;
}
