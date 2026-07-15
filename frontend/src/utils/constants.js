export const KEYS = {
  dailyPlan: 'mytimer.dailyPlan.v1',
  chat: 'mytimer.plannerChat.v1',
  sessions: 'mytimer.focusSessions.v1',
  distractions: 'mytimer.distractionList.v1',
  tracker: 'mytimer.focusTracker.v1',
  audit: 'mytimer.timeAudit.v1',
  reflections: 'mytimer.dailyReflection.v1',
  gate: 'mytimer.gateEntered.v1',
  soulQuotes: 'deepstudy.soulQuotes.v1',
  defaultSoulQuotesEnabled: 'deepstudy.defaultSoulQuotes.enabled.v1',
  noiseVolume: 'deepstudy.noiseVolume.v1',
  lastNoiseVolume: 'deepstudy.lastNoiseVolume.v1',
  workType: 'mytimer.workType.v1'
}

// 默认值
export const DEFAULT_PLANNER_SETTINGS = {
  mode: 'api',
  api: { baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-oss-120b:free' }
}

export const FREE_API_TUTORIAL_URL = 'https://my.feishu.cn/docx/Sr9RdRzFaop9BSxBgcAcdxDonOc'

// 分心四象限配置
export const DISTRACTION_CONFIGS = {
  'controllable-interesting': ['可控 + 有意思', '提前处理掉'],
  'controllable-boring': ['可控 + 没意思', '提前处理掉'],
  'uncontrollable-interesting': ['不可控 + 有意思', '顿一下再回来'],
  'uncontrollable-boring': ['不可控 + 没意思', '预设边界并规避']
}

// 长期任务四象限
export const QUADRANT_META = {
  'important-urgent': { label: '重要且紧急', subtitle: '立即推进，避免失控', color: '#df7779' },
  'important-not-urgent': { label: '重要不紧急', subtitle: '持续投入，建立长期优势', color: '#daa940' },
  'urgent-not-important': { label: '不重要但紧急', subtitle: '快速处理或减少投入', color: '#6d9ed0' },
  'not-important-not-urgent': { label: '不重要不紧急', subtitle: '谨慎保留，定期清理', color: '#80a595' }
}
