// @vitest-environment node
// The MiroFish runner (.github/scripts/mirofish_*.py) and the intake lane (src/lib/nexusIntake.ts, simGrading.ts) are built by
// different hands in different languages, and the record schema is the handshake between them. This test is that handshake made
// executable: the line the runner emits is validated and graded by the REAL TypeScript code, and the runner's offline Python
// suites run here so CI covers them. The fixture is synthetic (a fake clock and fake pins), emitted by the runner's own test.
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parseSimIntake, simRunRecordProblem, validateSimRunRecord } from '../lib/nexusIntake'
import { gradeSims, simVerdict } from '../lib/simGrading'

const fixture = () => JSON.parse(readFileSync('src/scripts/fixtures/mirofish-sim-run.nexus.json', 'utf8')) as Record<string, unknown>
const withMedian = (median: number) => ({ ...fixture(), median_lean_pct: median })

describe('the MiroFish runner offline python suites', () => {
  it('pass (meter, world builder, requirement filter, runner against a fake MiroFish, workflow properties)', () => {
    const r = spawnSync('python3', ['-B', '-m', 'unittest', 'discover', '-s', '.github/scripts', '-p', 'test_mirofish_*.py'],
      { encoding: 'utf8', env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' } })
    expect(r.stderr, r.stdout).toMatch(/\nOK\s*$/)
  }, 120_000)
})

describe('the runner\'s intake line against the real intake validator', () => {
  it('is a valid sim-run, field for field', () => {
    const line = fixture()
    expect(simRunRecordProblem(line)).toBeNull()
    const run = validateSimRunRecord(line)!
    expect(run).toMatchObject({
      kind: 'sim-run', source: 'mirofish-runner', marketRef: 'KXUFCFIGHT-26OCT24YANDVA-YAN', side: 'YES',
      positionRef: 'shadow:UFC333:KXUFCFIGHT-26OCT24YANDVA-YAN', reportRef: expect.stringContaining('/sim-results/UFC333/'),
      seed: { statsSnapshot: 'espn:600061267', matchupRead: true, humanState: false },
      engine: { agents: 6, model: 'kimi-k2.6', rounds: 4, mirofishCommit: 'a'.repeat(40) },
    })
    expect(run.engine.imageDigest).toMatch(/^sha256:[0-9a-f]{64}$/)
    expect(run.medianLeanPct).toBeGreaterThanOrEqual(0)
  })

  it('parses out of an intake file as exactly one run, none invalid, and its extra fields are ignored not rejected', () => {
    const parsed = parseSimIntake(`${JSON.stringify(fixture())}\n`)
    expect(parsed.runs).toHaveLength(1)
    expect(parsed.invalidSimLines).toBe(0)
    expect(parsed.runs[0].runId).toBe('sim-UFC333-KXUFCFIGHT-26OCT24YANDVA-YAN-a1')
  })

  it('carries a digest of the pinned source install in the field the schema calls image_digest, and says so', () => {
    const line = fixture() as { engine: Record<string, unknown> }
    expect(line.engine.digest_kind).toBe('source-install-environment')
    // The schema assumed a container image. Without a digest the line is not a record at all, which is why the runner emits this one.
    const engineWithout = { ...line.engine }
    delete engineWithout.image_digest
    expect(simRunRecordProblem({ ...fixture(), engine: engineWithout })).toMatch(/engine image digest pin/)
  })
})

describe('the runner\'s line, graded by the real grader', () => {
  const outcome = (winningSide: string) => ({ ts: 't', source: 'settling-lane', runId: 'sim-UFC333-KXUFCFIGHT-26OCT24YANDVA-YAN-a1', kind: 'sim-outcome' as const,
    marketRef: 'KXUFCFIGHT-26OCT24YANDVA-YAN', winningSide })

  it('scores the YES contract against the settled side: a 70% lean is a hit when YES wins and a miss when NO wins', () => {
    const run = validateSimRunRecord(withMedian(70))!
    expect(simVerdict(run, outcome('YES'))).toMatchObject({ hit: true, distance: expect.closeTo(0.3, 10) })
    expect(simVerdict(run, outcome('NO'))).toMatchObject({ hit: false, distance: expect.closeTo(0.7, 10) })
  })

  it('counts a median of exactly 50 as no call, as the golden fixture (median 50) is', () => {
    const run = validateSimRunRecord(fixture())!
    expect(run.medianLeanPct).toBe(50)
    expect(simVerdict(run, outcome('YES')).hit).toBeNull()
  })

  it('files the run under its market series and its engine model, so engines are graded separately', () => {
    const run = validateSimRunRecord(withMedian(70))!
    const graded = gradeSims([run], [outcome('YES')])
    expect(Object.keys(graded.bySeries)).toEqual(['KXUFCFIGHT'])
    expect(Object.keys(graded.byModel)).toEqual(['kimi-k2.6'])
    expect(graded.overall).toMatchObject({ runs: 1, settled: 1, called: 1, hits: 1 })
  })
})
