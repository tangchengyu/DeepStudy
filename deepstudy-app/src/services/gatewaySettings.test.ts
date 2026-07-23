import { beforeEach, describe, expect, it } from 'vitest'
import { createGatewaySettings } from './gatewaySettings'

describe('gateway settings', () => {
  beforeEach(() => localStorage.clear())

  it('allows a configurable public base URL but never stores credentials', () => {
    const settings = createGatewaySettings(localStorage, 'https://default.example.test')

    settings.setBaseUrl('https://pilot.example.com/')

    expect(settings.getBaseUrl()).toBe('https://pilot.example.com')
    expect(localStorage.getItem('deepstudy.gatewayBaseUrl')).toBe('https://pilot.example.com')
    expect(JSON.stringify(localStorage)).not.toContain('token')
  })

  it('rejects insecure non-local gateway URLs', () => {
    const settings = createGatewaySettings(localStorage, '')
    expect(() => settings.setBaseUrl('http://public.example.com')).toThrow('HTTPS')
    expect(() => settings.setBaseUrl('http://localhost:8787')).not.toThrow()
  })
})
