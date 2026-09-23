/*
 * ForgeClaw — Directive Item 3: Tier 0 reflex core.
 *
 * Decisions: compose the BM25 index and sparse elastic-net classifier behind a
 * read-only `evaluate` method. The result is explicitly a recommendation and
 * is never executed or admitted here; this preserves shadow-only behavior
 * until the unified Guardian gate (Item 4) is implemented. The confidence
 * threshold and retrieval limit are configurable because the spec-of-record
 * was not available in this checkout.
 *
 * Unfinished/untested: no live provider integration, Guardian admission,
 * promotion/eviction, persistence, telemetry, or concurrency lifecycle is
 * implemented. These remain Items 4–9.
 */

import { BM25Index, type BM25Document, type BM25Hit } from './bm25Index'
import {
  ElasticNetLogisticClassifier,
  type ClassifierExample,
  type ClassifierOptions,
  type ClassifierPrediction,
} from './linearClassifier'

export interface ReflexTrainingExample extends ClassifierExample {
  id: string
}

export interface Tier0Options extends ClassifierOptions {
  confidenceThreshold?: number
  retrievalLimit?: number
  bm25K1?: number
  bm25B?: number
}

export interface Tier0Evaluation {
  mode: 'shadow'
  handled: false
  prediction: ClassifierPrediction | null
  retrieval: BM25Hit[]
}

export class Tier0ReflexCore {
  private readonly index: BM25Index
  private readonly classifier: ElasticNetLogisticClassifier
  private readonly confidenceThreshold: number
  private readonly retrievalLimit: number

  constructor(options: Tier0Options = {}) {
    this.index = new BM25Index({ k1: options.bm25K1, b: options.bm25B })
    this.classifier = new ElasticNetLogisticClassifier(options)
    this.confidenceThreshold = options.confidenceThreshold ?? 0.85
    this.retrievalLimit = options.retrievalLimit ?? 3
  }

  train(examples: readonly ReflexTrainingExample[]): void {
    const documents: BM25Document[] = examples.map(({ id, text }) => ({ id, text }))
    for (const document of documents) this.index.add(document)
    this.classifier.fit(examples)
  }

  evaluate(text: string): Tier0Evaluation {
    const prediction = this.classifier.predict(text)
    const retrieval = this.index.search(text, this.retrievalLimit)
    const isConfident = (prediction?.confidence ?? 0) >= this.confidenceThreshold
    return {
      mode: 'shadow',
      // Item 4 must decide admission through Guardian; Item 3 never handles.
      handled: false,
      prediction: isConfident ? prediction : prediction,
      retrieval,
    }
  }

  get documentCount(): number {
    return this.index.size
  }

  get featureCount(): number {
    return this.classifier.featureCount
  }
}
