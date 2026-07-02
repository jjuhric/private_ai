const sqlite3 = require('sqlite3');

async function handleWeatherTool(db, userId, action, params) {
  if (!db || !userId) {
    return 'Error: Database connection and User ID are required to run weather queries.';
  }

  // 1. Fetch user profile configurations
  let profile;
  try {
    profile = await db.get('SELECT zipcode, country, temp_unit, weather_api_key FROM users WHERE id = ?', [userId]);
  } catch (err) {
    console.error('Failed to query user profile for weather:', err.message);
    return `Error: Failed to query user profile details: ${err.message}`;
  }

  if (!profile || !profile.weather_api_key) {
    return 'Error: OpenWeatherMap API Key is not configured. Please open your user profile by clicking your avatar in the sidebar footer and save your API Key.';
  }

  const apiKey = profile.weather_api_key;
  const units = profile.temp_unit || 'imperial';
  const unitSymbol = units === 'imperial' ? '°F' : (units === 'metric' ? '°C' : 'K');
  const speedUnit = units === 'imperial' ? 'mph' : 'm/s';

  // Resolve target location parameters
  const zipcode = params?.zipcode || profile.zipcode;
  const country = params?.country || profile.country || 'US';

  if (!zipcode) {
    return 'Error: Zipcode is not configured. Please set a zipcode in your profile or provide it in the tool parameters.';
  }

  // 2. Resolve Zipcode to Coordinates (lat/lon) via Geocoding API
  let lat, lon, cityName;
  try {
    const geoUrl = `http://api.openweathermap.org/geo/1.0/zip?zip=${encodeURIComponent(zipcode)},${encodeURIComponent(country)}&appid=${apiKey}`;
    const geoRes = await fetch(geoUrl);
    if (!geoRes.ok) {
      throw new Error(`Geocoding failed with status ${geoRes.status}: ${geoRes.statusText}`);
    }
    const geoData = await geoRes.json();
    lat = geoData.lat;
    lon = geoData.lon;
    cityName = geoData.name;
  } catch (err) {
    console.error('Geocoding API failed:', err.message);
    return `Error: Failed to resolve coordinates for Zipcode ${zipcode}, Country ${country}. Please verify your API Key and Location details. Error details: ${err.message}`;
  }

  // 3. Handle Actions
  if (action === 'current') {
    try {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&units=${units}&appid=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`Current weather API returned status ${res.status}`);
      }
      const data = await res.json();

      const temp = data.main.temp;
      const feelsLike = data.main.feels_like;
      const minTemp = data.main.temp_min;
      const maxTemp = data.main.temp_max;
      const desc = data.weather[0].description;
      const humidity = data.main.humidity;
      const pressure = data.main.pressure;
      const windSpeed = data.wind.speed;
      const seaLevel = data.main.sea_level || 'N/A';
      const grndLevel = data.main.grnd_level || 'N/A';
      const rain1h = data.rain ? data.rain['1h'] || '0' : '0';

      return `### 🌦️ Current Weather Report for **${cityName}** (${zipcode}, ${country})

| Parameter | Value |
| --- | --- |
| **Current Weather** | ${desc.charAt(0).toUpperCase() + desc.slice(1)} |
| **Temperature** | ${temp}${unitSymbol} (Min: ${minTemp}${unitSymbol} / Max: ${maxTemp}${unitSymbol}) |
| **Feels Like** | ${feelsLike}${unitSymbol} |
| **Humidity** | ${humidity}% |
| **Pressure** | ${pressure} hPa (Sea Level: ${seaLevel} / Ground Level: ${grndLevel}) |
| **Wind Speed** | ${windSpeed} ${speedUnit} |
| **Rain (last 1h)** | ${rain1h} mm |
`;
    } catch (err) {
      return `Error: Failed to query current weather: ${err.message}`;
    }
  } 
  
  else if (action === 'hourly') {
    // 4-day hourly forecast
    try {
      let url = `https://pro.openweathermap.org/data/2.5/forecast/hourly?lat=${lat}&lon=${lon}&units=${units}&appid=${apiKey}`;
      let res = await fetch(url);
      let data;
      
      // Fallback: If Pro API key fails, try the standard 3-hour forecast API
      if (!res.ok) {
        console.warn('Hourly forecast (Pro) failed, falling back to standard 3-hour forecast...');
        const fallbackUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${apiKey}`;
        res = await fetch(fallbackUrl);
        if (!res.ok) {
          throw new Error(`Standard forecast API failed: status ${res.status}`);
        }
      }
      
      data = await res.json();
      const list = data.list || [];
      
      let md = `### ⏰ Hourly Weather Forecast for **${cityName}** (Next 24 Hours)\n\n`;
      md += `| Time | Temp | Feels Like | Weather | Rain (1h) | Wind | Humidity |\n`;
      md += `| --- | --- | --- | --- | --- | --- | --- |\n`;

      // Display up to 24 hourly entries
      const entries = list.slice(0, 24);
      entries.forEach(item => {
        const time = item.dt_txt || new Date(item.dt * 1000).toLocaleString();
        const temp = item.main.temp;
        const feelsLike = item.main.feels_like;
        const desc = item.weather[0].description;
        const rain = item.rain ? item.rain['1h'] || item.rain['3h'] || '0' : '0';
        const wind = item.wind.speed;
        const humidity = item.main.humidity;

        md += `| ${time} | ${temp}${unitSymbol} | ${feelsLike}${unitSymbol} | ${desc} | ${rain} mm | ${wind} ${speedUnit} | ${humidity}% |\n`;
      });

      return md;
    } catch (err) {
      return `Error: Failed to fetch hourly forecast: ${err.message}`;
    }
  } 
  
  else if (action === 'daily') {
    // 16-day daily forecast
    const cnt = params?.cnt || 7; // default to a 7-day view
    try {
      const url = `https://api.openweathermap.org/data/2.5/forecast/daily?lat=${lat}&lon=${lon}&cnt=${cnt}&units=${units}&appid=${apiKey}`;
      const res = await fetch(url);
      let list = [];

      if (res.ok) {
        const data = await res.json();
        list = data.list || [];
      } else {
        // Fallback: If 16-day API is not accessible, calculate daily forecasts from the 5-day / 3-hour forecast API
        console.warn('Daily forecast API failed, calculating daily values from standard 5-day forecast...');
        const fallbackUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&units=${units}&appid=${apiKey}`;
        const fallbackRes = await fetch(fallbackUrl);
        if (!fallbackRes.ok) {
          throw new Error(`5-day forecast fallback failed: status ${fallbackRes.status}`);
        }
        
        const fallbackData = await fallbackRes.json();
        const rawList = fallbackData.list || [];
        
        // Group by Day
        const days = {};
        rawList.forEach(item => {
          const dateStr = new Date(item.dt * 1000).toLocaleDateString();
          if (!days[dateStr]) {
            days[dateStr] = [];
          }
          days[dateStr].push(item);
        });

        // Compute daily averages
        Object.keys(days).slice(0, cnt).forEach(dateStr => {
          const points = days[dateStr];
          const temps = points.map(p => p.main.temp);
          const min = Math.min(...temps);
          const max = Math.max(...temps);
          const avgDay = temps.reduce((a, b) => a + b, 0) / temps.length;
          
          // Select midday point for description/icon if possible
          const middayPoint = points.find(p => p.dt_txt && p.dt_txt.includes('12:00:00')) || points[0];
          
          list.push({
            dt: middayPoint.dt,
            temp: {
              day: parseFloat(avgDay.toFixed(1)),
              min: parseFloat(min.toFixed(1)),
              max: parseFloat(max.toFixed(1)),
              night: parseFloat(points[points.length - 1].main.temp.toFixed(1)),
              morn: parseFloat(points[0].main.temp.toFixed(1))
            },
            humidity: parseFloat((points.reduce((a, b) => a + b.main.humidity, 0) / points.length).toFixed(0)),
            speed: parseFloat((points.reduce((a, b) => a + b.wind.speed, 0) / points.length).toFixed(1)),
            weather: middayPoint.weather,
            clouds: parseFloat((points.reduce((a, b) => a + b.clouds.all, 0) / points.length).toFixed(0)),
            rain: points.some(p => p.rain) ? parseFloat(points.reduce((a, b) => a + (b.rain ? b.rain['3h'] || 0 : 0), 0).toFixed(1)) : 0
          });
        });
      }

      let md = `### 📅 Daily Weather Forecast for **${cityName}** (Next ${list.length} Days)\n\n`;
      md += `| Date | Temp (Day/Night) | Range (Min/Max) | Weather | Humidity | Wind | Rain |\n`;
      md += `| --- | --- | --- | --- | --- | --- | --- |\n`;

      list.forEach(item => {
        const date = new Date(item.dt * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const dayTemp = item.temp.day;
        const nightTemp = item.temp.night;
        const minTemp = item.temp.min;
        const maxTemp = item.temp.max;
        const desc = item.weather[0].description;
        const humidity = item.humidity;
        const speed = item.speed;
        const rain = item.rain || '0';

        md += `| ${date} | ${dayTemp}${unitSymbol} / ${nightTemp}${unitSymbol} | ${minTemp}${unitSymbol} - ${maxTemp}${unitSymbol} | ${desc} | ${humidity}% | ${speed} ${speedUnit} | ${rain} mm |\n`;
      });

      return md;
    } catch (err) {
      return `Error: Failed to fetch daily forecast: ${err.message}`;
    }
  } else if (action === 'onecall') {
    try {
      const url = `https://api.openweathermap.org/data/3.0/onecall?lat=${lat}&lon=${lon}&units=${units}&appid=${apiKey}`;
      const res = await fetch(url);
      if (!res.ok) {
        throw new Error(`One Call API returned status ${res.status}: ${res.statusText}`);
      }
      const data = await res.json();
      
      const current = data.current || {};
      const currentTemp = current.temp;
      const feelsLike = current.feels_like;
      const humidity = current.humidity;
      const windSpeed = current.wind_speed;
      const weatherDesc = current.weather?.[0]?.description || 'N/A';
      
      const daily = data.daily || [];
      let dailyMd = `#### 📅 7-Day Forecast:\n`;
      daily.slice(0, 7).forEach(day => {
        const date = new Date(day.dt * 1000).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
        const tempDay = day.temp?.day;
        const tempNight = day.temp?.night;
        const desc = day.weather?.[0]?.description || 'N/A';
        dailyMd += `- **${date}**: Day: ${tempDay}${unitSymbol}, Night: ${tempNight}${unitSymbol} - *${desc}*\n`;
      });

      return `### 🌦️ OpenWeatherMap One Call API Report for **${cityName}** (${zipcode}, ${country})
- **Current Temperature**: ${currentTemp}${unitSymbol} (Feels like: ${feelsLike}${unitSymbol})
- **Conditions**: ${weatherDesc.charAt(0).toUpperCase() + weatherDesc.slice(1)}
- **Humidity**: ${humidity}%
- **Wind Speed**: ${windSpeed} ${speedUnit}

${dailyMd}`;
    } catch (err) {
      console.error('One Call API failed:', err.message);
      return `Error: Failed to fetch One Call weather data: ${err.message}. (Ensure your API key is subscribed to One Call 3.0/4.0)`;
    }
  }

  return `Error: Unknown action "${action}" for weather tool.`;
}

module.exports = { handleWeatherTool };
