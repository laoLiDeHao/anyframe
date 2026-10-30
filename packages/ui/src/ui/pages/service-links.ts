import type { ServiceInfo } from '@anyframe/core'

export function parsePort(value: string): number | undefined {
  if (!value.trim()) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw Error('端口需为 1024–65535 的整数')
  return port
}

export function lanUrls(service: ServiceInfo): string[] {
  if (service.host !== '0.0.0.0') return []
  return [...new Set((service.urls ?? []).filter(value => {
    try {
      const url = new URL(value)
      const host = url.hostname.toLowerCase()
      return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
        !['localhost', '0.0.0.0', '[::]', '[::1]'].includes(host) && !host.startsWith('127.') && !host.endsWith('.localhost')
    } catch { return false }
  }))]
}

export function localUrl(service: ServiceInfo): string {
  return `http://127.0.0.1:${service.port}`
}
