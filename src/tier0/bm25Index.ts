/*
 * ForgeClaw — Directive Item 3: Tier 0 reflex core.
 *
 * Decisions: use a dependency-free BM25 inverted index with bounded token
 * storage. BM25 is paired with the linear classifier in reflexCore.ts so the
 * core can retrieve similar verified examples without embedding a large model.
 * k1 and b remain configurable because the unavailable spec-of-record did not
 * provide values; defaults use conventional BM25 settings (1.2, 0.75).
 *
 * Unfinished/untested: this index is not yet connected to live execution,
 * promotion/eviction, shadow telemetry, corpus sync, or Guardian. Those are
 * directive Items 4–9 and require separate approval and tests.
 */

export interface BM25Document {
  id: string
  text: string
}

export interface BM25Hit {
  id: string
  score: number
}

interface StoredDocument extends BM25Document {
  terms: Map<string, number>
  length: number
}

const TOKEN_RE = /[a-z0-9_]+/gi

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(TOKEN_RE) ?? []
}

export interface BM25Options {
  k1?: number
  b?: number
  maxTermsPerDocument?: number
  maxDocuments?: number
}

export class BM25Index {
  private readonly k1: number
  private readonly b: number
  private readonly maxTermsPerDocument: number
  private readonly maxDocuments: number
  private readonly documents = new Map<string, StoredDocument>()
  private readonly postings = new Map<string, Set<string>>()

  constructor(options: BM25Options = {}) {
    this.k1 = options.k1 ?? 1.2
    this.b = options.b ?? 0.75
    this.maxTermsPerDocument = options.maxTermsPerDocument ?? 512
    this.maxDocuments = options.maxDocuments ?? 1024
  }

  add(document: BM25Document): void {
    if (!this.documents.has(document.id) && this.documents.size >= this.maxDocuments) return
    this.remove(document.id)
    const tokens = tokenize(document.text).slice(0, this.maxTermsPerDocument)
    const terms = new Map<string, number>()
    for (const token of tokens) terms.set(token, (terms.get(token) ?? 0) + 1)
    const stored: StoredDocument = { ...document, terms, length: tokens.length }
    this.documents.set(document.id, stored)
    for (const term of terms.keys()) {
      const posting = this.postings.get(term) ?? new Set<string>()
      posting.add(document.id)
      this.postings.set(term, posting)
    }
  }

  remove(id: string): boolean {
    const document = this.documents.get(id)
    if (!document) return false
    this.documents.delete(id)
    for (const term of document.terms.keys()) {
      const posting = this.postings.get(term)
      posting?.delete(id)
      if (posting?.size === 0) this.postings.delete(term)
    }
    return true
  }

  search(query: string, limit = 5): BM25Hit[] {
    if (limit <= 0 || this.documents.size === 0) return []
    const queryTerms = new Set(tokenize(query))
    const candidates = new Set<string>()
    for (const term of queryTerms) {
      for (const id of this.postings.get(term) ?? []) candidates.add(id)
    }
    const averageLength = this.averageDocumentLength()
    const hits: BM25Hit[] = []
    for (const id of candidates) {
      const document = this.documents.get(id)
      if (!document) continue
      let score = 0
      for (const term of queryTerms) {
        const frequency = document.terms.get(term) ?? 0
        if (!frequency) continue
        const documentFrequency = this.postings.get(term)?.size ?? 0
        const inverseDocumentFrequency = Math.log(1 + (this.documents.size - documentFrequency + 0.5) / (documentFrequency + 0.5))
        const denominator = frequency + this.k1 * (1 - this.b + this.b * document.length / Math.max(averageLength, 1))
        score += inverseDocumentFrequency * (frequency * (this.k1 + 1)) / denominator
      }
      if (score > 0) hits.push({ id, score })
    }
    return hits.sort((a, b) => b.score - a.score).slice(0, limit)
  }

  get size(): number {
    return this.documents.size
  }

  private averageDocumentLength(): number {
    if (this.documents.size === 0) return 0
    let total = 0
    for (const document of this.documents.values()) total += document.length
    return total / this.documents.size
  }
}
