import { describe, expect, it, vi } from 'vitest'
import {
  createPlatformTurnstileAdapter,
  createTurnstileScriptLoader,
  createTurnstileWidgetOptions,
} from './turnstile'

describe('Turnstile platform adapter', () => {
  it('routes native and browser WebView challenges through replaceable adapters', async () => {
    const native = { render: vi.fn(async () => () => undefined) }
    const browser = { render: vi.fn(async () => () => undefined) }
    const nativeRouter = createPlatformTurnstileAdapter({
      isNativePlatform: () => true,
      native,
      browser,
    })
    const webRouter = createPlatformTurnstileAdapter({
      isNativePlatform: () => false,
      native,
      browser,
    })
    const container = document.createElement('div')
    const challenge = { siteKey: 'site-key', action: 'register' as const, onToken: vi.fn(), onError: vi.fn() }

    await nativeRouter.render(container, challenge)
    await webRouter.render(container, challenge)

    expect(native.render).toHaveBeenCalledOnce()
    expect(browser.render).toHaveBeenCalledOnce()
  })

  it('clears a failed script promise so a later challenge can retry', async () => {
    let apiReady = false
    const scripts: HTMLScriptElement[] = []
    const loader = createTurnstileScriptLoader({
      document,
      getApi: () => apiReady ? ({ render: vi.fn(), remove: vi.fn() }) : undefined,
      appendScript: (script) => { scripts.push(script) },
    })

    const first = loader()
    const firstScript = scripts[0]
    firstScript.dispatchEvent(new Event('error'))
    await expect(first).rejects.toThrow('人机验证加载失败')

    const second = loader()
    const secondScript = scripts[1]
    expect(secondScript).not.toBe(firstScript)
    apiReady = true
    secondScript.dispatchEvent(new Event('load'))
    await expect(second).resolves.toBeUndefined()
    secondScript.remove()
  })

  it('reports the Cloudflare error code and enables automatic challenge recovery', () => {
    const onError = vi.fn()
    const options = createTurnstileWidgetOptions({
      siteKey: 'site-key',
      action: 'sign-in',
      onToken: vi.fn(),
      onError,
    })

    expect(options).toMatchObject({
      retry: 'auto',
      'refresh-expired': 'auto',
      'refresh-timeout': 'auto',
    })
    expect((options['error-callback'] as (code: string) => boolean)('300030')).toBe(true)
    expect(onError).toHaveBeenCalledWith('人机验证失败（Cloudflare 错误码 300030），请检查网络或更新 Android System WebView 后重试')
  })
})
