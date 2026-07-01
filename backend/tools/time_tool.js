async function handleTimeTool(db, userId, action, params) {
  if (action === 'current_time') {
    const now = new Date();
    const utcISO = now.toISOString();
    
    // Format UTC date & time
    const formatter = new Intl.DateTimeFormat('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: true,
      timeZone: 'UTC'
    });
    
    const formatted = formatter.format(now);
    return `Current UTC Time: ${formatted} (ISO: ${utcISO})`;
  }

  if (action === 'lookup_timezone') {
    if (!db || !userId) {
      return 'Error: Database connection and User ID are required to lookup timezone.';
    }

    const zipcode = params?.zipcode;
    const country = params?.country || 'US';
    if (!zipcode) {
      return 'Error: Zipcode is required for timezone lookup.';
    }

    // Load weather API key
    let profile;
    try {
      profile = await db.get('SELECT weather_api_key FROM users WHERE id = ?', [userId]);
    } catch (err) {
      return `Error: Failed to query user profile: ${err.message}`;
    }

    if (!profile || !profile.weather_api_key) {
      return 'Error: OpenWeatherMap API Key is not configured in your profile settings.';
    }

    const apiKey = profile.weather_api_key;

    try {
      // 1. Resolve zipcode to coordinates
      const geoUrl = `http://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zipcode)},${encodeURIComponent(country)}&appid=${apiKey}`;
      const geoRes = await fetch(geoUrl);
      if (!geoRes.ok) {
        throw new Error(`Geocoding failed with status ${geoRes.status}`);
      }
      const geoData = await geoRes.json();
      const lat = geoData.lat;
      const lon = geoData.lon;
      const cityName = geoData.name;

      // 2. Fetch current weather to get the timezone offset (in seconds)
      const weatherUrl = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}`;
      const weatherRes = await fetch(weatherUrl);
      if (!weatherRes.ok) {
        throw new Error(`Weather API failed with status ${weatherRes.status}`);
      }
      const weatherData = await weatherRes.json();
      const timezoneOffsetSeconds = weatherData.timezone; // shift in seconds from UTC
      const timezoneOffsetHours = timezoneOffsetSeconds / 3600;

      // Format timezone offset (e.g., UTC-5)
      const sign = timezoneOffsetHours >= 0 ? '+' : '';
      const formattedOffset = `UTC${sign}${timezoneOffsetHours}`;

      return JSON.stringify({
        success: true,
        cityName,
        zipcode,
        country,
        latitude: lat,
        longitude: lon,
        timezoneOffsetSeconds,
        timezoneOffsetHours,
        timezoneFormatted: formattedOffset
      }, null, 2);
    } catch (err) {
      return `Error: Timezone lookup failed: ${err.message}`;
    }
  }

  return `Error: Unknown action "${action}" for time tool.`;
}

module.exports = { handleTimeTool };
