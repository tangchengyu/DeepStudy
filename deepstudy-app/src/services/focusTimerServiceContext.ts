import type { InjectionKey } from 'vue'
import type { FocusTimerService } from './focusTimerService'

export const focusTimerServiceKey: InjectionKey<FocusTimerService> = Symbol('focusTimerService')

