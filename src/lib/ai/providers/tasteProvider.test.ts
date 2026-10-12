import { describe, expect, it, vi } from 'vitest'
import { TasteProviderClient } from './tasteProvider'

describe('NEXUS Taste provider client', () => {
  it('submits an image, polls until complete, then sends feedback', async () => {
    const responses = [
      new Response(JSON.stringify({ job_id: 'job-1', status_url: '/v1/extract/job-1' }), { status: 202 }),
      new Response(JSON.stringify({ status: 'pending' }), { status: 200 }),
      new Response(JSON.stringify({ status: 'complete', image_id: 'image-1', features: { 'lighting.hardness': { value: 0.8, confidence: 0.9 } } }), { status: 200 }),
      new Response(JSON.stringify({ image_id: 'image-1', routing: 'attraction', update_type: 'attract', dimensions_updated: ['lighting.hardness'], centroid_displacement: 0.1, alpha_effective: 0.15, drift_flag: false }), { status: 200 }),
    ]
    const fetcher = vi.fn(async () => responses.shift() ?? new Response('{}', { status: 500 }))
    const client = new TasteProviderClient('http://127.0.0.1:8377/v1', fetcher)
    const result = await client.extractAndWait('data:image/png;base64,aGVsbG8=')
    expect(result.status).toBe('complete')
    await expect(client.feedback('image-1', 'fire', undefined, 'lighting.hardness')).resolves.toMatchObject({ update_type: 'attract' })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })

  it('surfaces expired jobs as an actionable error', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'JOB_EXPIRED' }), { status: 410 }))
    const client = new TasteProviderClient('http://127.0.0.1:8377/v1', fetcher)
    await expect(client.getExtractJob('expired')).rejects.toThrow('expired')
  })
})
