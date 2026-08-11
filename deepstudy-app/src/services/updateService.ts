export const RELEASES_API_URL = 'https://api.github.com/repos/tangchengyu/DeepStudy/releases?per_page=30'
export const RELEASES_ATOM_URL = 'https://github.com/tangchengyu/DeepStudy/releases.atom'
const RELEASE_DOWNLOAD_BASE_URL = 'https://github.com/tangchengyu/DeepStudy/releases/download'

export interface ReleaseAsset {
  name?: string
  browser_download_url?: string
}

export interface GitHubRelease {
  tag_name?: string
  name?: string
  draft?: boolean
  prerelease?: boolean
  html_url?: string
  assets?: ReleaseAsset[]
}

export interface UpdateResult {
  available: boolean
  currentVersion: string
  latestVersion: string
  tagName?: string
  releaseName?: string
  releaseUrl?: string
  assetName?: string
  assetUrl?: string
  message: string
}

declare const __APP_VERSION__: string

const MASTER_TAG_PATTERN = /^master-v(\d+\.\d+\.\d+)$/

export const currentAppVersion = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : '0.0.0'

export function parseMasterReleaseVersion(tagName: string | undefined | null) {
  const match = String(tagName || '').trim().match(MASTER_TAG_PATTERN)
  return match ? match[1] : null
}

function normalizeVersion(version: string) {
  return String(version || '')
    .trim()
    .replace(/^v/i, '')
    .split('.')
    .map((part) => {
      const value = Number.parseInt(part, 10)
      return Number.isFinite(value) ? value : 0
    })
    .slice(0, 3)
}

export function compareVersions(left: string, right: string) {
  const a = normalizeVersion(left)
  const b = normalizeVersion(right)
  for (let index = 0; index < 3; index += 1) {
    const diff = (a[index] || 0) - (b[index] || 0)
    if (diff > 0) return 1
    if (diff < 0) return -1
  }
  return 0
}

function assetPatternForPlatform(platform: string) {
  if (platform === 'android') return /\.apk$/i
  if (platform === 'win32' || platform === 'windows') return /\.exe$/i
  if (platform === 'darwin' || platform === 'mac') return /\.dmg$/i
  return null
}

function assetNameForPlatform(version: string, platform: string) {
  if (platform === 'android') return `DeepStudy-Android-master-v${version}.apk`
  if (platform === 'win32' || platform === 'windows') return `DeepStudy-Setup-${version}.exe`
  if (platform === 'darwin' || platform === 'mac') return `DeepStudy-Setup-${version}.dmg`
  return ''
}

function atomReleaseAssets(version: string, tagName: string): ReleaseAsset[] {
  return ['android', 'win32', 'darwin']
    .map((platform) => {
      const name = assetNameForPlatform(version, platform)
      return name
        ? {
            name,
            browser_download_url: `${RELEASE_DOWNLOAD_BASE_URL}/${encodeURIComponent(tagName)}/${encodeURIComponent(name)}`,
          }
        : null
    })
    .filter(Boolean) as ReleaseAsset[]
}

function findAsset(release: GitHubRelease, platform: string) {
  const pattern = assetPatternForPlatform(platform)
  if (!pattern) return null
  return (release.assets || []).find((asset) =>
    pattern.test(String(asset.name || '')) && String(asset.browser_download_url || '').startsWith('http'),
  ) || null
}

export function selectLatestUpdate(
  releases: GitHubRelease[],
  options: { currentVersion: string; platform: string },
): UpdateResult {
  const currentVersion = options.currentVersion
  const candidates = (Array.isArray(releases) ? releases : [])
    .map((release) => ({
      release,
      version: parseMasterReleaseVersion(release.tag_name),
      asset: findAsset(release, options.platform),
    }))
    .filter((candidate) =>
      candidate.version
      && candidate.asset
      && !candidate.release.draft
      && !candidate.release.prerelease,
    )
    .sort((left, right) => compareVersions(right.version!, left.version!))
  const latest = candidates[0]
  if (!latest) {
    return {
      available: false,
      currentVersion,
      latestVersion: currentVersion,
      message: '没有找到适用于当前设备的更新包。',
    }
  }
  const available = compareVersions(latest.version!, currentVersion) > 0
  return {
    available,
    currentVersion,
    latestVersion: latest.version!,
    tagName: latest.release.tag_name,
    releaseName: latest.release.name || latest.release.tag_name,
    releaseUrl: latest.release.html_url,
    assetName: latest.asset!.name,
    assetUrl: latest.asset!.browser_download_url,
    message: available ? '发现新版本。' : '当前已是最新版本。',
  }
}

export function releasesFromAtom(atomText: string): GitHubRelease[] {
  const text = String(atomText || '')
  const links = [...text.matchAll(/href=["']([^"']*\/releases\/tag\/([^"']+))["']/gi)]
    .map((match) => ({
      url: match[1].replace(/&amp;/g, '&'),
      tagName: decodeURIComponent(match[2].replace(/&amp;/g, '&')),
    }))
  const seen = new Set<string>()
  return links
    .filter(({ tagName }) => {
      if (seen.has(tagName)) return false
      seen.add(tagName)
      return Boolean(parseMasterReleaseVersion(tagName))
    })
    .map(({ tagName, url }) => {
      const version = parseMasterReleaseVersion(tagName)!
      return {
        tag_name: tagName,
        name: `DeepStudy Master ${version}`,
        draft: false,
        prerelease: false,
        html_url: url,
        assets: atomReleaseAssets(version, tagName),
      }
    })
}

async function fetchApiReleases(fetchFn: typeof fetch) {
  const response = await fetchFn(RELEASES_API_URL, {
    headers: {
      accept: 'application/vnd.github+json',
    },
  })
  if (!response.ok) throw new Error(`检查更新失败：GitHub 返回 HTTP ${response.status}`)
  return await response.json() as GitHubRelease[]
}

async function fetchAtomReleases(fetchFn: typeof fetch) {
  const response = await fetchFn(RELEASES_ATOM_URL, {
    headers: {
      accept: 'application/atom+xml,text/xml;q=0.9,text/plain;q=0.8',
    },
  })
  if (!response.ok) throw new Error(`检查更新失败：GitHub 返回 HTTP ${response.status}`)
  return releasesFromAtom(await response.text())
}

async function fetchReleasesWithFallback(fetchFn: typeof fetch) {
  try {
    return await fetchApiReleases(fetchFn)
  } catch (apiError) {
    try {
      const releases = await fetchAtomReleases(fetchFn)
      if (releases.length > 0) return releases
    } catch {
      // Keep the GitHub API error visible when both public endpoints are unavailable.
    }
    throw apiError
  }
}

export async function checkForUpdates(fetchFn: typeof fetch = fetch) {
  const releases = await fetchReleasesWithFallback(fetchFn)
  return selectLatestUpdate(releases, {
    currentVersion: currentAppVersion,
    platform: 'android',
  })
}

export function openUpdateDownload(url: string) {
  if (!/^https:\/\//i.test(url)) throw new Error('更新下载链接无效。')
  window.open(url, '_system', 'noopener,noreferrer')
}
