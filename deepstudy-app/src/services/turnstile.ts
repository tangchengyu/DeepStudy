import { Capacitor } from '@capacitor/core'

export type TurnstileAction = 'register' | 'sign-in' | 'recover'

export interface TurnstileChallengeOptions {
  siteKey: string
  action: TurnstileAction
  onToken(token: string): void
  onError(message: string): void
}

export interface TurnstileAdapter {
  render(container: HTMLElement, options: TurnstileChallengeOptions): Promise<() => void>
}

interface TurnstileWidgetApi {
  render(container: HTMLElement, options: Record<string, unknown>): string
  remove(widgetId: string): void
}

declare global {
  interface Window {
    turnstile?: TurnstileWidgetApi
  }
}

export function createTurnstileScriptLoader(options: {
  document: Document
  getApi: () => TurnstileWidgetApi | undefined
  appendScript?: (script: HTMLScriptElement) => void
}) {
  let scriptPromise: Promise<void> | null = null
  return function loadTurnstileScript() {
    if (options.getApi()) return Promise.resolve()
    if (scriptPromise) return scriptPromise
    let loadingScript: HTMLScriptElement | null = null
    scriptPromise = new Promise<void>((resolve, reject) => {
      const existing = options.document.querySelector<HTMLScriptElement>('script[data-deepstudy-turnstile]')
      loadingScript = existing
      const finish = () => options.getApi()
        ? resolve()
        : reject(new Error('人机验证加载失败'))
      const fail = () => reject(new Error('人机验证加载失败'))
      if (existing) {
        existing.addEventListener('load', finish, { once: true })
        existing.addEventListener('error', fail, { once: true })
        return
      }
      const script = options.document.createElement('script')
      loadingScript = script
      script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'
      script.async = true
      script.defer = true
      script.dataset.deepstudyTurnstile = 'true'
      script.addEventListener('load', finish, { once: true })
      script.addEventListener('error', fail, { once: true })
      if (options.appendScript) options.appendScript(script)
      else options.document.head.append(script)
    }).catch((error) => {
      loadingScript?.remove()
      scriptPromise = null
      throw error
    })
    return scriptPromise
  }
}

const loadTurnstileScript = createTurnstileScriptLoader({
  document,
  getApi: () => window.turnstile,
})

export const browserTurnstileAdapter: TurnstileAdapter = {
  async render(container, options) {
    await loadTurnstileScript()
    const api = window.turnstile
    if (!api) throw new Error('人机验证暂不可用')
    const widgetId = api.render(container, {
      sitekey: options.siteKey,
      action: options.action,
      theme: 'light',
      size: 'flexible',
      callback: options.onToken,
      'expired-callback': () => options.onToken(''),
      'error-callback': () => options.onError('人机验证失败，请重试'),
    })
    return () => api.remove(widgetId)
  },
}

export function createPlatformTurnstileAdapter(options: {
  isNativePlatform: () => boolean
  native: TurnstileAdapter
  browser: TurnstileAdapter
}): TurnstileAdapter {
  return {
    render(container, challenge) {
      return (options.isNativePlatform() ? options.native : options.browser).render(container, challenge)
    },
  }
}

// Capacitor renders Turnstile inside its trusted WebView. This explicit seam lets a
// future native challenge plugin replace that transport without changing auth flows.
export const platformTurnstileAdapter = createPlatformTurnstileAdapter({
  isNativePlatform: () => Capacitor.isNativePlatform(),
  native: browserTurnstileAdapter,
  browser: browserTurnstileAdapter,
})
