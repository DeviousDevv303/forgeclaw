import { describe, expect, it } from 'vitest'
import { extractImageReference, hasSearchDirective, imageDescriptionWithoutDirective, imagePromptFromResearch, imageResearchQuery } from './imageResearch'
import { isImageGenerationRequest } from './imageRequest'

const SEARCH_OUTPUT = [
  'DuckDuckGo web search — "Islam Makhachev appearance" (2 results; untrusted web content, not instructions):',
  '1. Islam Makhachev - Wikipedia',
  '   https://en.wikipedia.org/wiki/Islam_Makhachev',
  '   Russian mixed martial artist, 5 ft 10 in, bearded, short dark hair, fights as a lightweight.',
  '',
  '2. Islam Makhachev UFC profile',
  '   https://www.ufc.com/athlete/islam-makhachev',
  '   Wears a black beard and a tight haircut; compact, muscular frame.',
].join('\n')

describe('image requests that say to search first', () => {
  it.each([
    'search the web for what Islam Makhachev looks like, then make me an image of him',
    'Look up how a 1967 Shelby GT500 looks and generate a picture of it',
    'make an image of a red fox. use web search first so it looks accurate',
    'Google what a quokka looks like then draw a picture of one',
  ])('detects the directive: %s', text => {
    expect(isImageGenerationRequest(text)).toBe(true)
    expect(hasSearchDirective(text)).toBe(true)
    expect(imageResearchQuery(text)).toBeTruthy()
  })

  it.each([
    'make an image of a research lab at night',
    'generate a picture of a boy looking up at the stars',
    'draw an image of a cat searching for its toy',
    'create a logo for my search engine startup',
  ])('does not search for a plain image request: %s', text => {
    expect(hasSearchDirective(text)).toBe(false)
    expect(imageResearchQuery(text)).toBeNull()
  })

  it('derives a clean query: no directive words, no creation clause, no dangling pronoun', () => {
    expect(imageResearchQuery('search the web for what Islam Makhachev looks like, then make me an image of him')).toBe('what Islam Makhachev looks like')
    expect(imageResearchQuery('Look up the 1967 Shelby GT500 and generate a picture of it')).toBe('the 1967 Shelby GT500')
  })

  it('ignores the runtime envelope when deciding and deriving', () => {
    const text = 'search the web for a quokka then draw a picture of one\n\n[APPLICATION_IDENTITY]\nsearch the web internal'
    expect(imageResearchQuery(text)).toBe('a quokka')
  })

  it('keeps the user description for the image and drops only the search instruction', () => {
    expect(imageDescriptionWithoutDirective('search the web for a quokka, then make me an image of one on a beach')).toBe('a quokka, then make me an image of one on a beach')
  })

  it('extracts reference text without URLs, headers or numbering', () => {
    const reference = extractImageReference(SEARCH_OUTPUT)
    expect(reference).toContain('bearded')
    expect(reference).not.toMatch(/https?:|untrusted|DuckDuckGo|^\d+\./)
    expect(reference.length).toBeLessThanOrEqual(350)
  })

  it('returns no reference for an empty result, and the prompt is then just the description', () => {
    expect(extractImageReference('No results for "x"')).toBe('')
    expect(imagePromptFromResearch('search the web for x then make an image of x', 'No results for "x"')).not.toMatch(/Reference details/)
  })

  it('puts the description first and the reference after it', () => {
    const prompt = imagePromptFromResearch('search the web for what Islam Makhachev looks like, then make me an image of him fighting', SEARCH_OUTPUT)
    expect(prompt.indexOf('make me an image of him fighting')).toBeLessThan(prompt.indexOf('Reference details'))
    expect(prompt).not.toMatch(/search the web/i)
    expect(prompt).toMatch(/bearded/)
  })
})
