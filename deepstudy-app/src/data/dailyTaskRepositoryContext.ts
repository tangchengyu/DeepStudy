import type { InjectionKey } from 'vue'
import type { DailyTaskRepository } from './dailyTaskRepository'

export const dailyTaskRepositoryKey: InjectionKey<DailyTaskRepository> = Symbol('dailyTaskRepository')
