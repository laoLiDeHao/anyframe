import { describe, expect, it } from 'vitest'
import type { ServiceInfo } from '@anyframe/core'
import { lanUrls, localUrl, parsePort } from './service-links.ts'

const service: ServiceInfo = { id: 'demo', name: 'express-demo', status: 'running', mode: 'embedded', host: '0.0.0.0', port: 47800, startedAt: 0, restartCount: 0 }
describe('service access links', () => {
  it('shares reachable addresses without loopback, wildcard, duplicates or invalid URLs', () => {
    const urls = ['http://127.0.0.1:47800', 'http://localhost:47800', 'http://0.0.0.0:47800', 'http://[::1]:47800', 'http://[::]:47800', 'invalid', 'javascript:alert(1)', 'http://192.168.1.20:47800', 'http://192.168.1.20:47800', 'http://10.0.0.20:47800']
    expect(lanUrls({ ...service, urls })).toEqual(['http://192.168.1.20:47800', 'http://10.0.0.20:47800'])
    expect(lanUrls({ ...service, host: '127.0.0.1', urls })).toEqual([])
    expect(lanUrls(service)).toEqual([])
  })
  it('opens the service locally even when sharing uses a LAN address', () => {
    expect(localUrl(service)).toBe('http://127.0.0.1:47800')
  })
  it('accepts automatic allocation and validates ports before restarting', () => {
    expect(parsePort('')).toBeUndefined()
    expect(parsePort('1024')).toBe(1024)
    expect(parsePort('65535')).toBe(65535)
    for (const value of ['1023', '65536', '1.5', 'abc', '-1']) expect(() => parsePort(value)).toThrow('端口')
  })
})
