// @vitest-environment node
// The language selector must actually change the interface. These tests pin the layer behind it:
// Spanish is complete and genuinely translated, every key the code uses exists, placeholders survive
// translation, English is the fallback, and the choice is detected, saved and shared.
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  DICTIONARIES, EN, LANGUAGES, LOCALE_TAGS, STORAGE_KEY,
  __setLangForTests, detectInitialLanguage, getLang, isLang, setLang, translate, useI18n, type Key,
} from './i18n'
import { FailureDashboard } from '../components/FailureDashboard'

class MemoryStorage implements Storage {
  private values = new Map<string, string>()
  get length() { return this.values.size }
  clear() { this.values.clear() }
  getItem(key: string) { return this.values.get(key) ?? null }
  key(index: number) { return Array.from(this.values.keys())[index] ?? null }
  removeItem(key: string) { this.values.delete(key) }
  setItem(key: string, value: string) { this.values.set(key, value) }
}

const keys = Object.keys(EN) as Key[]
const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort()

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return walk(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\./.test(name) && name !== 'i18n.ts' ? [path] : []
  })
}
const sources = walk('src').map(path => readFileSync(path, 'utf8')).join('\n')

// Spanish strings that are legitimately identical to English (brand terms, technical tokens, cognates).
const SAME_IN_SPANISH = new Set<Key>([
  'tab.nexus', 'severity.info', 'severity.error', 'diag.ok', 'activity.ok', 'activity.local',
  'activity.errors', 'wa.chat', 'wa.error', 'monitor.error', 'event.error', 'agentState.head',
  'agentState.repo', 'live.phase.PLAN', 'wa.clear', 'state.set', 'header.wipe',
].filter(k => (EN as Record<string, string>)[k] === (DICTIONARIES.es as Record<string, string>)[k]) as Key[])

describe('dictionaries', () => {
  it('has a Spanish string for every key, none empty', () => {
    for (const key of keys) {
      const value = DICTIONARIES.es[key]
      expect(typeof value, key).toBe('string')
      expect(value!.trim().length, key).toBeGreaterThan(0)
    }
  })

  it('has no Spanish keys that English lacks', () => {
    expect(Object.keys(DICTIONARIES.es).filter(k => !(k in EN))).toEqual([])
  })

  it('keeps {placeholders} identical in every language', () => {
    for (const lang of LANGUAGES) {
      for (const key of keys) {
        const value = DICTIONARIES[lang][key]
        if (value !== undefined) expect(placeholders(value), `${lang}:${key}`).toEqual(placeholders(EN[key]))
      }
    }
  })

  it('does not leave Spanish silently in English (copy-paste regressions)', () => {
    const untranslated = keys.filter(key => DICTIONARIES.es[key] === EN[key] && !SAME_IN_SPANISH.has(key))
    expect(untranslated).toEqual([])
  })

  it('actually translates the headline interface in Spanish', () => {
    expect(translate('es', 'tab.settings')).toBe('AJUSTES')
    expect(translate('es', 'tab.activity')).toBe('ACTIVIDAD')
    expect(translate('es', 'chat.send')).toBe('ENVIAR')
    expect(translate('es', 'chat.placeholder')).toContain('Pregunta')
    expect(translate('en', 'tab.settings')).toBe('SETTINGS')
  })
})

describe('translate', () => {
  it('fills placeholders and leaves unknown ones visible', () => {
    expect(translate('en', 'activity.summary', { responses: 3, tools: 7 })).toBe('3 RESPONSES · 7 TOOL CALLS')
    expect(translate('es', 'activity.summary', { responses: 3, tools: 7 })).toBe('3 RESPUESTAS · 7 LLAMADAS A HERRAMIENTAS')
    expect(translate('en', 'activity.summary', { responses: 3 })).toContain('{tools}')
  })

  it('falls back to English for a key Russian or Chinese lacks, never to a raw key', () => {
    expect(DICTIONARIES.ru['settings.githubToken']).toBeUndefined()
    expect(translate('ru', 'settings.githubToken')).toBe(EN['settings.githubToken'])
    expect(translate('zh', 'settings.githubToken')).toBe(EN['settings.githubToken'])
    expect(translate('ru', 'tab.settings')).toBe('НАСТРОЙКИ')
    expect(translate('zh', 'tab.settings')).toBe('设置')
  })

  it('returns the key itself only for a key that does not exist anywhere', () => {
    expect(translate('es', 'no.such.key' as Key)).toBe('no.such.key')
  })
})

describe('source usage', () => {
  const literal = [...sources.matchAll(/\bt\(\s*'([\w.-]+)'/g)].map(m => m[1])
  const viaTranslate = [...sources.matchAll(/translate\(getLang\(\),\s*'([\w.-]+)'/g)].map(m => m[1])

  it('only uses keys that exist', () => {
    const missing = [...new Set([...literal, ...viaTranslate])].filter(k => !(k in EN))
    expect(missing).toEqual([])
  })

  it('covers the dynamic key families completely', () => {
    const families: Record<string, string[]> = {
      'agentState.status.': ['idle', 'in_progress', 'blocked', 'complete'],
      'live.phase.': ['OBJECTIVE', 'PLAN', 'EXECUTION', 'VERIFICATION', 'NEXT_ACTION', 'COMPLETE', 'BLOCKED'],
      'severity.': ['info', 'warning', 'error', 'critical'],
      'agents.cap.': ['chat', 'coding-readonly', 'coding'],
    }
    for (const [prefix, members] of Object.entries(families)) {
      for (const member of members) expect(`${prefix}${member}` in EN, `${prefix}${member}`).toBe(true)
    }
  })

  it('has no dead keys', () => {
    const dynamicPrefixes = ['agentState.status.', 'live.phase.', 'severity.', 'agents.cap.']
    const dead = keys.filter(key =>
      !sources.includes(`'${key}'`) && !sources.includes(`"${key}"`) && !dynamicPrefixes.some(p => key.startsWith(p)))
    expect(dead).toEqual([])
  })
})

describe('language detection', () => {
  it('prefers a saved choice', () => {
    expect(detectInitialLanguage('es', ['en-US'])).toBe('es')
    expect(detectInitialLanguage('en', ['es-MX'])).toBe('en')
  })
  it('follows the browser language when nothing is saved (a Mexican phone opens in Spanish)', () => {
    expect(detectInitialLanguage(null, ['es-MX', 'en-US'])).toBe('es')
    expect(detectInitialLanguage(null, ['fr-FR', 'es'])).toBe('es')
    expect(detectInitialLanguage(null, ['ru-RU'])).toBe('ru')
  })
  it('defaults to English for unsupported languages and ignores a corrupt saved value', () => {
    expect(detectInitialLanguage(null, ['fr-FR', 'de'])).toBe('en')
    expect(detectInitialLanguage(null, [])).toBe('en')
    expect(detectInitialLanguage('klingon', ['en-US'])).toBe('en')
    expect(isLang('es')).toBe(true)
    expect(isLang('ES')).toBe(false)
  })
  it('uses Mexican Spanish for speech and dates', () => {
    expect(LOCALE_TAGS.es).toBe('es-MX')
    expect(LOCALE_TAGS.en).toBe('en-US')
  })
})

describe('the shared store behind the selector', () => {
  beforeEach(() => { vi.stubGlobal('localStorage', new MemoryStorage()); __setLangForTests('en') })
  afterEach(() => { vi.unstubAllGlobals(); __setLangForTests('en') })

  const Probe = () => { const { t } = useI18n(); return createElement('span', null, t('tab.settings')) }

  it('switches what a component renders, in both directions', () => {
    expect(renderToString(createElement(Probe))).toContain('SETTINGS')
    setLang('es')
    expect(getLang()).toBe('es')
    expect(renderToString(createElement(Probe))).toContain('AJUSTES')
    setLang('en')
    expect(renderToString(createElement(Probe))).toContain('SETTINGS')
  })

  it('saves the choice and ignores invalid values', () => {
    setLang('es')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('es')
    setLang('klingon')
    expect(getLang()).toBe('es')
    expect(localStorage.getItem(STORAGE_KEY)).toBe('es')
  })

  it('still switches when storage is unavailable', () => {
    vi.stubGlobal('localStorage', { getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
    expect(() => setLang('es')).not.toThrow()
    expect(getLang()).toBe('es')
  })

  it('translates a real component (the failure ledger empty state)', () => {
    const props = { ledger: [], onResolve: () => {}, onClearResolved: () => {} }
    expect(renderToString(createElement(FailureDashboard, props))).toContain('No failures logged.')
    setLang('es')
    const html = renderToString(createElement(FailureDashboard, props))
    expect(html).toContain('No hay fallas registradas.')
    expect(html).not.toContain('No failures logged.')
  })
})

describe('EF-03: the corpus push button states what it did', () => {
  it('names the reason and the count when the reply was not confirmed, and never says admitted', () => {
    for (const lang of ['en', 'es'] as const) {
      const text = translate(lang, 'corpus.notConfirmed', { n: 3, reason: 'Webhook HTTP 500.' })
      expect(text).toContain('Webhook HTTP 500.')
      expect(text).toContain('3')
    }
  })
  it('says a successful push admits nothing', () => {
    expect(translate('en', 'corpus.sentMany', { n: 4, m: 1 })).toContain('Nothing is admitted')
    expect(translate('es', 'corpus.sentMany', { n: 4, m: 1 })).toContain('no admite nada')
    expect(translate('en', 'settings.syncPending')).not.toMatch(/sync/i)
  })
})
