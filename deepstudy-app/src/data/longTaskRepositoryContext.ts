import type { InjectionKey } from 'vue'
import type { LongTaskRepository } from './longTaskRepository'

export const longTaskRepositoryKey: InjectionKey<LongTaskRepository> = Symbol('longTaskRepository')
