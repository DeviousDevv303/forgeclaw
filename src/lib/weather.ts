// ForgeClaw — Copyright (c) 2026 DeviousDevv303 (Cristian). All Rights Reserved.
// Proprietary source-available license. Commercial use requires written permission. See LICENSE.
// ─── Weather: a real forecast, not a list of links ───────────────────────────
// "What's the weather tomorrow in OKC" got forecast *links* from web_search: search snippets don't carry
// the numbers. Open-Meteo is free, needs no key and allows browser requests, so the forecast is fetched
// directly: place → coordinates (geocoding API) → daily forecast in the place's own time zone.

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

/** Common nicknames the geocoder doesn't know. */
const PLACE_ALIASES: Record<string, string> = {
  okc: 'Oklahoma City', nyc: 'New York', la: 'Los Angeles', sf: 'San Francisco', dc: 'Washington',
  philly: 'Philadelphia', vegas: 'Las Vegas', nola: 'New Orleans', atl: 'Atlanta', chi: 'Chicago',
  cos: 'Colorado Springs', 'the springs': 'Colorado Springs', denver: 'Denver', tulsa: 'Tulsa',
}

/** WMO weather codes → words (https://open-meteo.com/en/docs). */
const WMO: Record<number, string> = {
  0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast', 45: 'fog', 48: 'freezing fog',
  51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle', 56: 'freezing drizzle', 57: 'heavy freezing drizzle',
  61: 'light rain', 63: 'rain', 65: 'heavy rain', 66: 'freezing rain', 67: 'heavy freezing rain',
  71: 'light snow', 73: 'snow', 75: 'heavy snow', 77: 'snow grains', 80: 'rain showers', 81: 'heavy rain showers',
  82: 'violent rain showers', 85: 'snow showers', 86: 'heavy snow showers', 95: 'thunderstorms',
  96: 'thunderstorms with hail', 99: 'severe thunderstorms with hail',
}

export function isWeatherQuestion(text: string): boolean {
  return /\b(weather|forecast|temperature|temp|rain(?:ing)?|snow(?:ing)?|storms?|windy|humid|how (?:hot|cold|warm))\b/i.test(text)
    && !/\b(forgeclaw|repo|workflow|code|function)\b/i.test(text)
}

/** The place named in a weather question ("... in OKC", "... for Denver, CO"), or '' when none is named. */
export function extractPlace(text: string): string {
  const m = /\b(?:in|for|at|near|around)\s+([A-Za-z][A-Za-z .'-]*(?:,\s*[A-Za-z .]+)?)/i.exec(text)
  if (!m) return ''
  return m[1]
    .replace(/\b(today|tonight|tomorrow|this (?:week|weekend|morning|afternoon|evening)|right now|now|next \w+)\b.*$/i, '')
    .replace(/[?!.\s]+$/, '')
    .trim()
}

/** How many days from today the question asks about (0 today, 1 tomorrow), or null for "the next few days". */
export function requestedDay(text: string): number | null {
  if (/\btomorrow\b/i.test(text)) return 1
  if (/\b(today|tonight|right now|now)\b/i.test(text)) return 0
  return null
}

interface Place { name: string; admin1?: string; country_code?: string; latitude: number; longitude: number }
interface Daily { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[] }

type Fetch = (url: string, init?: RequestInit) => Promise<Response>

export async function geocode(place: string, doFetch: Fetch = fetch, signal?: AbortSignal): Promise<Place> {
  const raw = place.trim()
  const name = PLACE_ALIASES[raw.toLowerCase()] ?? raw.split(',')[0].trim()
  if (!name) throw new Error('Which place? Say "weather tomorrow in Oklahoma City", for example.')
  const res = await doFetch(`${GEOCODE_URL}?name=${encodeURIComponent(name)}&count=5&language=en&format=json`, { signal })
  if (!res.ok) throw new Error(`weather lookup failed: geocoding ${res.status}`)
  const results = ((await res.json()) as { results?: Place[] }).results ?? []
  if (!results.length) throw new Error(`no place called "${name}" was found`)
  // "Denver, CO" / "Paris, TX": prefer the match whose region or country fits the part after the comma.
  const hint = raw.includes(',') ? raw.split(',')[1].trim().toLowerCase() : ''
  return (hint && results.find(r => (r.admin1 ?? '').toLowerCase().startsWith(hint) || (r.country_code ?? '').toLowerCase() === hint || US_STATES[hint] === r.admin1)) || results[0]
}

const US_STATES: Record<string, string> = { ok: 'Oklahoma', co: 'Colorado', tx: 'Texas', ca: 'California', ny: 'New York', fl: 'Florida', il: 'Illinois', ks: 'Kansas', ar: 'Arkansas', mo: 'Missouri', nm: 'New Mexico', az: 'Arizona', ga: 'Georgia', wa: 'Washington', or: 'Oregon', nv: 'Nevada', ut: 'Utah' }

/** A plain-text forecast for a place: the asked-about day first, then the next days. */
export async function weatherForecast(input: { place: string; day?: number | null; doFetch?: Fetch; signal?: AbortSignal }): Promise<string> {
  const doFetch = input.doFetch ?? fetch
  const place = await geocode(input.place, doFetch, input.signal)
  const params = new URLSearchParams({
    latitude: String(place.latitude), longitude: String(place.longitude),
    daily: 'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max',
    temperature_unit: 'fahrenheit', wind_speed_unit: 'mph', timezone: 'auto', forecast_days: '7',
  })
  const res = await doFetch(`${FORECAST_URL}?${params}`, { signal: input.signal })
  if (!res.ok) throw new Error(`weather lookup failed: forecast ${res.status}`)
  const daily = ((await res.json()) as { daily?: Daily }).daily
  if (!daily?.time?.length) throw new Error('the forecast service returned no days')
  const where = [place.name, place.admin1, place.country_code].filter(Boolean).join(', ')
  const line = (i: number) => {
    const date = new Date(`${daily.time[i]}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
    return `${date}: ${WMO[daily.weather_code[i]] ?? 'mixed'}, high ${Math.round(daily.temperature_2m_max[i])}°F / low ${Math.round(daily.temperature_2m_min[i])}°F, ` +
      `${daily.precipitation_probability_max[i] ?? 0}% chance of rain, wind up to ${Math.round(daily.wind_speed_10m_max[i])} mph`
  }
  const day = input.day ?? null
  const first = day !== null && day < daily.time.length ? [day] : []
  const rest = daily.time.map((_, i) => i).filter(i => !first.includes(i) && (day === null ? i < 4 : i > (day ?? 0) && i <= (day ?? 0) + 2))
  return [`✓ Weather for ${where} (Open-Meteo, local time):`, ...first.map(line), ...(rest.length ? ['Next days:', ...rest.map(line)] : [])].join('\n')
}
