import { CapacitorHttp } from '@capacitor/core'

// Keep local RPC outside WebView mixed-content/CORS/local-network restrictions.
export const nativeRpcFetch: typeof fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (!/^http:\/\/127\.0\.0\.1:\d+\//.test(url)) throw Error('原生 RPC 仅允许本机地址')
  if (init?.signal?.aborted) throw Error('请求已取消')
  const headers = Object.fromEntries(new Headers(init?.headers).entries())
  const result = await CapacitorHttp.request({
    url, method: init?.method ?? 'GET', headers,
    ...(init?.body ? { data: JSON.parse(String(init.body)) } : {}),
    connectTimeout: 5000, readTimeout: 15000, responseType: 'text',
  })
  return new Response(typeof result.data === 'string' ? result.data : JSON.stringify(result.data),
    { status: result.status, headers: result.headers })
}
