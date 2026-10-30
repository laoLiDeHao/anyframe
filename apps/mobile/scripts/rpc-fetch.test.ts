import { describe, expect, it, vi } from 'vitest'
const request = vi.hoisted(() => vi.fn())
vi.mock('@capacitor/core', () => ({ CapacitorHttp: { request } }))
import { nativeRpcFetch } from '../src/native/rpc-fetch'

describe('native local RPC transport', () => {
  it('carries authentication and JSON through native HTTP and returns a Fetch response', async () => {
    request.mockResolvedValue({ status: 200, headers: { 'Content-Type': 'application/json' }, data: '{"ok":true}' })
    const response = await nativeRpcFetch('http://127.0.0.1:47810/rpc/fs.write', {
      method: 'POST', headers: { 'X-AnyFrame-Token': 'secret' }, body: JSON.stringify({ text: '中文' }),
    })
    expect(request).toHaveBeenLastCalledWith(expect.objectContaining({ method: 'POST', headers: { 'x-anyframe-token': 'secret' }, data: { text: '中文' } }))
    expect(await response.json()).toEqual({ ok: true })
    request.mockResolvedValue({ status: 503, headers: {}, data: { error: 'not ready' } })
    expect((await nativeRpcFetch('http://127.0.0.1:47810/healthz')).ok).toBe(false)
  })
  it('rejects destinations outside the loopback RPC endpoint', async () => {
    await expect(nativeRpcFetch('http://192.168.1.1/rpc/fs.read')).rejects.toThrow('本机')
  })
})
