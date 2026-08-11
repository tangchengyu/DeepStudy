import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import indexHtml from '../../index.html?raw'
import launcherBackground from '../../android/app/src/main/res/values/ic_launcher_background.xml?raw'

const projectRoot = resolve(__dirname, '../..')

function readText(path: string) {
  return readFileSync(path, 'utf8')
}

function readBinary(path: string) {
  return readFileSync(path, 'binary')
}

function pngSize(path: string) {
  const data = readBinary(path)
  expect(data.slice(1, 4)).toBe('PNG')
  return [readUint32(data, 16), readUint32(data, 20)]
}

function readUint32(data: string, offset: number) {
  return (
    (data.charCodeAt(offset) << 24) |
    (data.charCodeAt(offset + 1) << 16) |
    (data.charCodeAt(offset + 2) << 8) |
    data.charCodeAt(offset + 3)
  ) >>> 0
}

describe('DeepStudy mobile branding', () => {
  it('uses the desktop DeepStudy green and gold theme instead of the old purple mobile palette', () => {
    const appStyles = readText(resolve(projectRoot, 'src/styles.css'))

    expect(indexHtml).toContain('<meta name="theme-color" content="#f3f7f2" />')
    expect(appStyles).toContain('--accent: #70ad99;')
    expect(appStyles).toContain('--accent-strong: #568f7c;')
    expect(appStyles).toContain('--plan: #d9b86f;')
    expect(appStyles).toContain('--background: #f3f7f2;')
    expect(appStyles).toContain('--surface: #fffdf9;')
    expect(appStyles).not.toMatch(/#6255d9|#4f43c0|#9389ef|#eeecff|#ebe8ff/i)
    expect(launcherBackground).toContain('#F3F7F2')
  })

  it('ships density-specific Android launcher icons with an adaptive foreground', () => {
    expect(pngSize(resolve(projectRoot, 'src/assets/deepstudy-clock-icon.png'))).toEqual([512, 512])
    expect(pngSize(resolve(projectRoot, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'))).toEqual([192, 192])
    expect(pngSize(resolve(projectRoot, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png'))).toEqual([192, 192])
    expect(pngSize(resolve(projectRoot, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png'))).toEqual([432, 432])
  })

  it('keeps mobile headings and quadrant cards compact enough for narrow phones', () => {
    const appStyles = readText(resolve(projectRoot, 'src/styles.css'))
    const longBoard = readText(resolve(projectRoot, 'src/views/LongBoardView.vue'))

    expect(appStyles).toContain('font-size: clamp(1.55rem, 6.2vw, 2.05rem);')
    expect(appStyles).toContain('line-height: 1.22;')
    expect(appStyles).toContain('font-size: 0.8rem;')
    expect(longBoard).toContain('font-size: 0.78rem;')
    expect(longBoard).toContain('grid-template-columns: 1.45rem minmax(0, 1fr) auto;')
    expect(longBoard).toContain('padding: 0.9rem 0.7rem;')
  })
})
