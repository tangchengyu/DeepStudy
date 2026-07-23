import type { QuadrantId } from '../data/longTaskRepository'

export interface QuadrantDefinition {
  id: QuadrantId
  numeral: string
  title: string
}

export const quadrants: QuadrantDefinition[] = [
  { id: 'important-urgent', numeral: 'I', title: '重要且紧急' },
  { id: 'important-not-urgent', numeral: 'II', title: '重要不紧急' },
  { id: 'urgent-not-important', numeral: 'III', title: '不重要但紧急' },
  { id: 'not-important-not-urgent', numeral: 'IV', title: '不重要不紧急' },
]

export function findQuadrant(id: QuadrantId): QuadrantDefinition {
  return quadrants.find((quadrant) => quadrant.id === id) ?? quadrants[0]
}
