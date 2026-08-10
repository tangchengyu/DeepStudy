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

  it('ships the desktop alarm-clock icon as the Android launcher icon', () => {
    const desktopClockIcon = readBinary(resolve(projectRoot, 'src/assets/deepstudy-clock-icon.png'))
    const androidLauncherIcon = readBinary(resolve(projectRoot, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png'))
    const androidLauncherForeground = readBinary(resolve(projectRoot, 'android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png'))

    expect(androidLauncherIcon).toBe(desktopClockIcon)
    expect(androidLauncherForeground).toBe(desktopClockIcon)
  })
})
