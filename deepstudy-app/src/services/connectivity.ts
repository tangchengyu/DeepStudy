export interface ConnectivityMonitor {
  isOnline(): boolean
  subscribe(listener: (online: boolean) => void): () => void
}

export function createBrowserConnectivityMonitor(target: Window = window): ConnectivityMonitor {
  return {
    isOnline: () => target.navigator.onLine,
    subscribe(listener) {
      const online = () => listener(true)
      const offline = () => listener(false)
      target.addEventListener('online', online)
      target.addEventListener('offline', offline)
      return () => {
        target.removeEventListener('online', online)
        target.removeEventListener('offline', offline)
      }
    },
  }
}
