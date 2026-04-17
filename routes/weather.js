'use strict';

const { Router } = require('express');

// In-memory cache: { key: { data, expiresAt } }
const weatherCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 min

function createWeatherRoutes({ stores, sendSuccess, sendError }) {
  const router = Router();

  // GET /weather/:festivalId — returns weather for festival's coordinates
  router.get('/:festivalId', async (req, res) => {
    try {
      const { festivalId } = req.params;

      // Check cache first
      const cached = weatherCache.get(festivalId);
      if (cached && cached.expiresAt > Date.now()) {
        return sendSuccess(res, cached.data);
      }

      // Get festival coordinates
      const result = await stores.pool.query(
        'SELECT latitude, longitude, name FROM festivals WHERE id = $1 AND deleted_at IS NULL',
        [festivalId]
      );
      if (result.rows.length === 0) {
        return sendError(res, 404, 'Festival not found');
      }

      const { latitude, longitude } = result.rows[0];
      if (!latitude || !longitude) {
        return sendSuccess(res, { available: false, reason: 'No coordinates set for this festival' });
      }

      // Fetch from Open-Meteo (free, no API key needed)
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,weathercode&hourly=temperature_2m,precipitation_probability,weathercode&timezone=auto&forecast_days=7`;

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);

      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);

      if (!resp.ok) {
        return sendSuccess(res, { available: false, reason: 'Weather service unavailable' });
      }

      const weather = await resp.json();
      const data = {
        available: true,
        latitude,
        longitude,
        timezone: weather.timezone,
        daily: {
          dates: weather.daily?.time || [],
          maxTemp: weather.daily?.temperature_2m_max || [],
          minTemp: weather.daily?.temperature_2m_min || [],
          precipChance: weather.daily?.precipitation_probability_max || [],
          weatherCode: weather.daily?.weathercode || [],
        },
        hourly: {
          times: weather.hourly?.time || [],
          temp: weather.hourly?.temperature_2m || [],
          precipChance: weather.hourly?.precipitation_probability || [],
          weatherCode: weather.hourly?.weathercode || [],
        },
      };

      // Cache it
      weatherCache.set(festivalId, { data, expiresAt: Date.now() + CACHE_TTL_MS });
      // Evict old entries
      if (weatherCache.size > 50) {
        for (const [key, val] of weatherCache) {
          if (val.expiresAt < Date.now()) weatherCache.delete(key);
        }
      }

      sendSuccess(res, data);
    } catch (err) {
      if (err.name === 'AbortError') {
        return sendSuccess(res, { available: false, reason: 'Weather request timed out' });
      }
      sendError(res, 500, err.message);
    }
  });

  return router;
}

module.exports = { createWeatherRoutes };
