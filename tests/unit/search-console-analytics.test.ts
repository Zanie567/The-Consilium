import { afterEach, describe, expect, it, vi } from 'vitest'
import { generateKeyPairSync } from 'node:crypto'
import { comparePct, findSearchOpportunities, getSearchConsoleReport } from '@/lib/searchConsoleAnalytics'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('Search Console read-only reporting', () => {
  it('shows a real not-connected state instead of false zero metrics', async () => {
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL', '')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY', '')
    vi.stubEnv('GSC_PROPERTY', '')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    const result = await getSearchConsoleReport('30d')
    expect(result.status).toBe('not_connected')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('refuses an unrelated Search Console property before any Google request', async () => {
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL', 'reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY', 'not-a-real-key')
    vi.stubEnv('GSC_PROPERTY', 'sc-domain:unrelated.example')
    const fetcher = vi.fn()
    vi.stubGlobal('fetch', fetcher)
    expect((await getSearchConsoleReport('30d')).status).toBe('unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('uses server-side, read-only credentials and separate site summary and query/page requests', async () => {
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL', 'reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY', privateKey.export({ type: 'pkcs8', format: 'pem' }).toString())
    vi.stubEnv('GSC_PROPERTY', 'sc-domain:theconsilium.co.uk')
    const fetcher = vi.fn().mockImplementation(async (url: string, options: {body: string, headers:Record<string,string>}) => {
      if (url === 'https://oauth2.googleapis.com/token') {
        const params = new URLSearchParams(options.body)
        expect(params.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:jwt-bearer')
        const jwt = params.get('assertion') ?? ''
        const claims = JSON.parse(Buffer.from(jwt.split('.')[1], 'base64url').toString())
        expect(claims.scope).toBe('https://www.googleapis.com/auth/webmasters.readonly')
        return { ok: true, json: async () => ({ access_token: 'test-token' }) }
      }
      expect(url).toContain('/webmasters/v3/sites/sc-domain%3Atheconsilium.co.uk/searchAnalytics/query')
      expect(options.headers.Authorization).toBe('Bearer test-token')
      const payload = JSON.parse(options.body)
      expect(payload.type).toBe('web')
      expect(payload.dataState).toBe('final')
      if (payload.dimensions.length === 0) return { ok: true, json: async () => ({ rows: [{clicks:5,impressions:100,ctr:0.05,position:10}] }) }
      if (payload.dimensions[0] === 'page') return { ok: true, json: async () => ({
        rows: [{ keys:['https://theconsilium.co.uk/articles/example'],clicks:1,impressions:30,ctr:0.02,position:8 }],
      }) }
      return { ok: true, json: async () => ({rows:[]}) }
    })
    vi.stubGlobal('fetch', fetcher)
    const result = await getSearchConsoleReport('24h')
    expect(result.status).toBe('connected')
    if (result.status !== 'connected') throw Error('Expected connected')
    expect(result.requestedPeriod).toBe('7d')
    expect(result.summary.clicks).toBe(5)
    expect(result.topPages).toHaveLength(1)
    expect(result.opportunities).toHaveLength(1)
    expect(fetcher).toHaveBeenCalledTimes(7) // token + six analytics requests
    const again = await getSearchConsoleReport('24h')
    expect(again.status).toBe('connected')
    expect(fetcher).toHaveBeenCalledTimes(7) // cached report
  })

  it('identifies invalid private key input without making a Google request', async () => {
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL','reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY','invalid-key')
    vi.stubEnv('GSC_PROPERTY','sc-domain:theconsilium.co.uk')
    const fetcher=vi.fn()
    vi.stubGlobal('fetch',fetcher)
    const result=await getSearchConsoleReport('7d')
    expect(result.status).toBe('unavailable')
    if(result.status!=='unavailable') throw new Error('Expected unavailable')
    expect(result.message).toContain('private key is not valid')
    expect(result.message).not.toContain('invalid-key')
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('distinguishes a rejected Google access token from missing property permission', async () => {
    const { privateKey } = generateKeyPairSync('rsa',{modulusLength:2048})
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL','reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY',privateKey.export({type:'pkcs8',format:'pem'}).toString())
    vi.stubEnv('GSC_PROPERTY','sc-domain:theconsilium.co.uk')
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:false,status:400}))
    const result=await getSearchConsoleReport('30d')
    expect(result.status).toBe('unavailable')
    if(result.status!=='unavailable') throw new Error('Expected unavailable')
    expect(result.message).toContain('rejected the service-account authentication')
  })

  it('guides permission repair for an authenticated but forbidden Search Console property', async () => {
    const { privateKey } = generateKeyPairSync('rsa',{modulusLength:2048})
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL','reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY',privateKey.export({type:'pkcs8',format:'pem'}).toString())
    vi.stubEnv('GSC_PROPERTY','sc-domain:theconsilium.co.uk')
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>
      url==='https://oauth2.googleapis.com/token' ? {ok:true,json:async()=>({access_token:'not-real'})}
      : {ok:false,status:403,json:async()=>({error:{message:'sensitive upstream text',errors:[{reason:'forbidden'}]}})}
    ))
    const result=await getSearchConsoleReport('30d')
    expect(result.status).toBe('unavailable')
    if(result.status!=='unavailable') throw new Error('Expected unavailable')
    expect(result.message).toContain('Restricted user')
    expect(result.message).not.toContain('sensitive upstream text')
  })

  it('identifies Google Search Console API disabled without reflecting Google error details', async () => {
    const { privateKey } = generateKeyPairSync('rsa',{modulusLength:2048})
    vi.stubEnv('GSC_SERVICE_ACCOUNT_EMAIL','reader@example.iam.gserviceaccount.com')
    vi.stubEnv('GSC_SERVICE_ACCOUNT_PRIVATE_KEY',privateKey.export({type:'pkcs8',format:'pem'}).toString())
    vi.stubEnv('GSC_PROPERTY','sc-domain:theconsilium.co.uk')
    vi.stubGlobal('fetch',vi.fn().mockImplementation(async(url:string)=>
      url==='https://oauth2.googleapis.com/token' ? {ok:true,json:async()=>({access_token:'not-real'})}
      : {ok:false,status:403,json:async()=>({error:{status:'SERVICE_DISABLED',message:'sensitive upstream text'}})}
    ))
    const result=await getSearchConsoleReport('30d')
    expect(result.status).toBe('unavailable')
    if(result.status!=='unavailable') throw new Error('Expected unavailable')
    expect(result.message).toContain('Enable Search Console API')
    expect(result.message).not.toContain('sensitive upstream text')
  })

  it('does not manufacture growth or guarantee a result from small samples', () => {
    expect(comparePct(10,0)).toBeNull()
    expect(comparePct(20,10)).toBe(100)
    expect(findSearchOpportunities([
      {label:'a',clicks:1,impressions:10,ctr:0.01,position:8},
      {label:'b',clicks:1,impressions:100,ctr:0.01,position:8},
      {label:'c',clicks:10,impressions:100,ctr:0.1,position:8},
    ]).map(x=>x.label)).toEqual(['b'])
  })
})
