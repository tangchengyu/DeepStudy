const gatewayUrlKey = 'deepstudy.gatewayBaseUrl'
export const productionGatewayBaseUrl = 'https://deepstudy-gateway.jackbreese585.workers.dev'

export function normalizeGatewayBaseUrl(value: string) {
  const trimmed = value.trim()
  if (!trimmed) return ''
  let parsed: URL
  try {
    parsed = new URL(trimmed)
  } catch {
    throw new Error('请输入有效的网关地址')
  }
  const isLocal = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1'
  if (parsed.protocol !== 'https:' && !(isLocal && parsed.protocol === 'http:')) {
    throw new Error('网关地址必须使用 HTTPS（本机开发地址除外）')
  }
  if (parsed.username || parsed.password) throw new Error('网关地址不能包含账号或密码')
  return parsed.origin
}

export function createGatewaySettings(
  storage: Pick<Storage, 'getItem' | 'removeItem' | 'setItem'>,
  buildDefault = import.meta.env.VITE_GATEWAY_BASE_URL ?? productionGatewayBaseUrl,
) {
  const defaultUrl = normalizeGatewayBaseUrl(buildDefault)
  return {
    getBaseUrl() {
      return storage.getItem(gatewayUrlKey) || defaultUrl
    },
    setBaseUrl(value: string) {
      const normalized = normalizeGatewayBaseUrl(value)
      if (!normalized || normalized === defaultUrl) storage.removeItem(gatewayUrlKey)
      else storage.setItem(gatewayUrlKey, normalized)
      return normalized || defaultUrl
    },
    reset() {
      storage.removeItem(gatewayUrlKey)
    },
  }
}

export const gatewaySettings = createGatewaySettings(globalThis.localStorage)
