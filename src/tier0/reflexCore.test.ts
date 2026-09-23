/*
 * ForgeClaw — Directive Item 3 tests.
 *
 * Decisions: test deterministic local behavior only, with tiny fixtures that
 * exercise retrieval, sparse SGD classification, and the explicit shadow-only
 * contract. No live provider, Guardian, promotion, eviction, or telemetry
 * behavior is tested here because those are unfinished Items 4–9.
 */

import { describe, expect, it } from 'vitest'
import { BM25Index } from './bm25Index'
import { ElasticNetLogisticClassifier } from './linearClassifier'
import { Tier0ReflexCore } from './reflexCore'

describe('BM25Index', () => {
  it('ranks documents sharing query terms', () => {
    const index = new BM25Index()
    index.add({ id: 'local', text: 'use local inference runtime' })
    index.add({ id: 'cloud', text: 'use cloud inference runtime' })

    expect(index.search('local inference')[0]?.id).toBe('local')
  })
})

describe('ElasticNetLogisticClassifier', () => {
  it('learns a small linearly separable command set', () => {
    const classifier = new ElasticNetLogisticClassifier({ epochs: 20, learningRate: 0.1 })
    classifier.fit([
      { text: 'run local test', label: 'local' },
      { text: 'call local model', label: 'local' },
      { text: 'search the web', label: 'web' },
      { text: 'browse web source', label: 'web' },
    ])

    expect(classifier.predict('local model')?.label).toBe('local')
    expect(classifier.classCount).toBe(2)
  })
})

describe('Tier0ReflexCore', () => {
  it('returns a recommendation while never handling the request itself', () => {
    const core = new Tier0ReflexCore({ epochs: 20, learningRate: 0.1 })
    core.train([
      { id: 'local-1', text: 'run local test', label: 'local' },
      { id: 'web-1', text: 'search the web', label: 'web' },
    ])

    const result = core.evaluate('local test')
    expect(result.mode).toBe('shadow')
    expect(result.handled).toBe(false)
    expect(result.retrieval[0]?.id).toBe('local-1')
  })
})
