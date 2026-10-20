import { describe, expect, it } from 'vitest'
import { extractPlace, geocode, isWeatherQuestion, requestedDay, weatherForecast } from './weather'
import { routeLiveDataQuestion } from './liveDataRouting'

const GEO = 'https://geocoding-api.open-meteo.com/v1/search'
function fakeFetch(places: unknown[]) {
  const urls: string[] = []
  const doFetch = async (url: string) => {
    urls.push(url)
    if (url.startsWith(GEO)) return Response.json({ results: places })
    return Response.json({ daily: {
      time: ['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23'],
      weather_code: [3, 0, 61, 95], temperature_2m_max: [75.4, 78.2, 70, 66], temperature_2m_min: [55, 56.4, 60, 50],
      precipitation_probability_max: [5, 3, 60, 80], wind_speed_10m_max: [9, 10.2, 15, 20],
    } })
  }
  return { doFetch, urls }
}
const OKC = { name: 'Oklahoma City', admin1: 'Oklahoma', country_code: 'US', latitude: 35.47, longitude: -97.52 }

describe('weather', () => {
  it("reads the place and day from the question that only got links (2026-10-20)", () => {
    const q = "What's the weather like tomorrow in okc"
    expect(isWeatherQuestion(q)).toBe(true)
    expect(extractPlace(q)).toBe('okc')
    expect(requestedDay(q)).toBe(1)
    expect(extractPlace('weather in Denver, CO today?')).toBe('Denver, CO')
    expect(extractPlace("what's the weather like")).toBe('')
    expect(isWeatherQuestion('fix the forecast workflow in the repo')).toBe(false)
  })

  it('returns real numbers, the asked-about day first, from the forecast service', async () => {
    const f = fakeFetch([OKC])
    const text = await weatherForecast({ place: 'okc', day: 1, doFetch: f.doFetch })
    expect(f.urls[0]).toContain('name=Oklahoma%20City')  // nickname resolved before geocoding
    expect(f.urls[1]).toMatch(/latitude=35\.47&longitude=-97\.52.*temperature_unit=fahrenheit/)
    const lines = text.split('\n')
    expect(lines[0]).toBe('✓ Weather for Oklahoma City, Oklahoma, US (Open-Meteo, local time):')
    expect(lines[1]).toMatch(/^Wednesday, Oct 21: clear, high 78°F \/ low 56°F, 3% chance of rain, wind up to 10 mph$/)
    expect(text).toContain('Thursday, Oct 22: light rain')
  })

  it('picks the right "Denver, CO" and says so plainly when a place is unknown', async () => {
    const two = [{ name: 'Denver', admin1: 'Pennsylvania', country_code: 'US', latitude: 1, longitude: 1 }, { name: 'Denver', admin1: 'Colorado', country_code: 'US', latitude: 39.7, longitude: -105 }]
    expect((await geocode('Denver, CO', fakeFetch(two).doFetch)).admin1).toBe('Colorado')
    await expect(weatherForecast({ place: 'Atlantisxyz', doFetch: fakeFetch([]).doFetch })).rejects.toThrow(/no place called "Atlantisxyz"/)
  })

  it('DeepSeek quick path: weather with a place gets the forecast tool, without one it still searches', () => {
    expect(routeLiveDataQuestion("What's the weather like tomorrow in okc")).toMatchObject({ name: 'weather_forecast', input: { place: 'okc', day: '1' } })
    expect(routeLiveDataQuestion("what's the weather forecast?")).toMatchObject({ name: 'web_search' })
  })
})
