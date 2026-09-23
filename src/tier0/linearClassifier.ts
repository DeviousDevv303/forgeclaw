/*
 * ForgeClaw — Directive Item 3: Tier 0 reflex core.
 *
 * Decisions: use sparse one-vs-rest logistic regression trained with bounded
 * SGD and elastic-net regularization. Sparse maps keep resident memory small
 * and make inference linear in the input vocabulary. Learning rate, epochs,
 * L1/L2 weights, and confidence cutoff remain configurable because the
 * unavailable spec-of-record did not settle calibration values; conservative
 * defaults are provided for shadow-mode experimentation only.
 *
 * Unfinished/untested: no holdout calibration, promotion/eviction lifecycle,
 * live cutover, or Guardian integration exists here. Those belong to Items 4–9.
 */

import { tokenize } from './bm25Index'

export interface ClassifierExample {
  text: string
  label: string
}

export interface ClassifierOptions {
  epochs?: number
  learningRate?: number
  l1?: number
  l2?: number
}

export interface ClassifierPrediction {
  label: string
  confidence: number
  scores: Record<string, number>
}

function vectorize(text: string): Map<string, number> {
  const vector = new Map<string, number>()
  for (const token of tokenize(text)) vector.set(token, (vector.get(token) ?? 0) + 1)
  return vector
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value)
    return 1 / (1 + z)
  }
  const z = Math.exp(value)
  return z / (1 + z)
}

export class ElasticNetLogisticClassifier {
  private readonly epochs: number
  private readonly learningRate: number
  private readonly l1: number
  private readonly l2: number
  private readonly weights = new Map<string, Map<string, number>>()
  private readonly labels: string[] = []

  constructor(options: ClassifierOptions = {}) {
    this.epochs = options.epochs ?? 8
    this.learningRate = options.learningRate ?? 0.08
    this.l1 = options.l1 ?? 0.0005
    this.l2 = options.l2 ?? 0.0005
  }

  fit(examples: readonly ClassifierExample[]): void {
    this.weights.clear()
    this.labels.splice(0, this.labels.length, ...Array.from(new Set(examples.map(example => example.label))).sort())
    for (const label of this.labels) this.weights.set(label, new Map())
    if (this.labels.length < 2) return

    const vectors = examples.map(example => ({ vector: vectorize(example.text), label: example.label }))
    for (let epoch = 0; epoch < this.epochs; epoch++) {
      for (const { vector, label } of vectors) {
        for (const candidate of this.labels) {
          const weights = this.weights.get(candidate) as Map<string, number>
          const target = candidate === label ? 1 : 0
          let logit = 0
          for (const [term, value] of vector) logit += (weights.get(term) ?? 0) * value
          const error = sigmoid(logit) - target
          for (const [term, value] of vector) {
            const oldWeight = weights.get(term) ?? 0
            const gradient = error * value + this.l2 * oldWeight + this.l1 * Math.sign(oldWeight)
            const nextWeight = oldWeight - this.learningRate * gradient
            if (Math.abs(nextWeight) < this.l1 * this.learningRate) weights.delete(term)
            else weights.set(term, nextWeight)
          }
        }
      }
    }
  }

  predict(text: string): ClassifierPrediction | null {
    if (this.labels.length === 0) return null
    const vector = vectorize(text)
    const scores: Record<string, number> = {}
    let bestLabel = this.labels[0]
    let bestScore = -Infinity
    for (const label of this.labels) {
      const weights = this.weights.get(label) as Map<string, number>
      let logit = 0
      for (const [term, value] of vector) logit += (weights.get(term) ?? 0) * value
      const score = sigmoid(logit)
      scores[label] = score
      if (score > bestScore) {
        bestLabel = label
        bestScore = score
      }
    }
    return { label: bestLabel, confidence: bestScore, scores }
  }

  get classCount(): number {
    return this.labels.length
  }

  get featureCount(): number {
    const features = new Set<string>()
    for (const weights of this.weights.values()) for (const term of weights.keys()) features.add(term)
    return features.size
  }
}
