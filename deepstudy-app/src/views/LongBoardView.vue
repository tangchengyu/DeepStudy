<script setup lang="ts">
import { inject, onMounted, reactive } from 'vue'
import { RouterLink } from 'vue-router'
import {
  longTaskRepository,
  type LongTask,
  type QuadrantId,
} from '../data/longTaskRepository'
import { longTaskRepositoryKey } from '../data/longTaskRepositoryContext'
import { quadrants } from '../domain/quadrants'

const repository = inject(longTaskRepositoryKey, longTaskRepository)
const tasksByQuadrant = reactive<Record<QuadrantId, LongTask[]>>({
  'important-urgent': [],
  'important-not-urgent': [],
  'urgent-not-important': [],
  'not-important-not-urgent': [],
})

onMounted(async () => {
  await Promise.all(
    quadrants.map(async (quadrant) => {
      tasksByQuadrant[quadrant.id] = await repository.listByQuadrant(quadrant.id)
    }),
  )
})
</script>

<template>
  <main class="page long-board-page">
    <header class="page-heading">
      <div>
        <p class="eyebrow">长期规划</p>
        <h1>四象限</h1>
      </div>
      <p class="page-caption">按重要性与紧急程度查看</p>
    </header>

    <section class="quadrant-grid" aria-label="长期任务四象限">
      <article
        v-for="quadrant in quadrants"
        :key="quadrant.id"
        class="quadrant-card"
        :class="`quadrant-card--${quadrant.id}`"
        data-testid="quadrant-card"
        :data-quadrant="quadrant.id"
      >
        <RouterLink :to="`/long/${quadrant.id}`" class="quadrant-card__link">
          <header class="quadrant-card__header">
            <span class="quadrant-card__numeral">{{ quadrant.numeral }}</span>
            <h2>{{ quadrant.title }}</h2>
            <span class="quadrant-card__count" :aria-label="`${tasksByQuadrant[quadrant.id].length} 项任务`">
              {{ tasksByQuadrant[quadrant.id].length }}
            </span>
          </header>
          <ul v-if="tasksByQuadrant[quadrant.id].length" class="quadrant-preview">
            <li v-for="task in tasksByQuadrant[quadrant.id].slice(0, 4)" :key="task.entityId">
              <span class="preview-checkbox" aria-hidden="true" />
              <span>{{ task.title }}</span>
            </li>
          </ul>
          <p v-else class="quadrant-card__empty">暂无任务</p>
          <p v-if="tasksByQuadrant[quadrant.id].length > 4" class="quadrant-card__more">
            还有 {{ tasksByQuadrant[quadrant.id].length - 4 }} 项
          </p>
        </RouterLink>
      </article>
    </section>
  </main>
</template>

<style scoped>
.long-board-page {
  padding-bottom: 1rem;
}

.page-heading {
  align-items: flex-start;
  display: flex;
  gap: 0.8rem;
  justify-content: space-between;
  margin-bottom: 1.05rem;
}

.page-heading h1 {
  font-size: clamp(1.65rem, 7vw, 2.2rem);
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0.15rem 0 0;
}

.eyebrow,
.page-caption {
  color: var(--text-muted);
  font-size: 0.72rem;
  line-height: 1.35;
  margin: 0;
}

.eyebrow {
  font-weight: 700;
  letter-spacing: 0.13em;
  text-transform: uppercase;
}

.page-caption {
  max-width: 9.5rem;
  text-align: right;
}

.quadrant-grid {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.quadrant-card {
  background: var(--surface);
  border: 1px solid var(--border-soft);
  border-radius: 1.25rem;
  min-height: 13.5rem;
  overflow: hidden;
}

.quadrant-card__link {
  color: inherit;
  display: flex;
  flex-direction: column;
  height: 100%;
  padding: 0.9rem 0.7rem;
  text-decoration: none;
}

.quadrant-card__link:focus-visible {
  box-shadow: inset 0 0 0 3px var(--focus-ring);
  outline: none;
}

.quadrant-card__header {
  align-items: center;
  display: grid;
  gap: 0.35rem;
  grid-template-columns: 1.45rem minmax(0, 1fr) auto;
}

.quadrant-card__header h2 {
  font-size: 0.78rem;
  line-height: 1.25;
  margin: 0;
  overflow-wrap: anywhere;
}

.quadrant-card__numeral {
  align-items: center;
  background: var(--quadrant-color);
  border-radius: 999px;
  color: #fff;
  display: inline-flex;
  font-family: Georgia, serif;
  font-size: 0.68rem;
  height: 1.45rem;
  justify-content: center;
  width: 1.45rem;
}

.quadrant-card__count {
  color: var(--text-muted);
  font-size: 0.72rem;
}

.quadrant-card--important-urgent {
  --quadrant-color: #e95364;
}

.quadrant-card--important-not-urgent {
  --quadrant-color: #e6a700;
}

.quadrant-card--urgent-not-important {
  --quadrant-color: #477fe2;
}

.quadrant-card--not-important-not-urgent {
  --quadrant-color: #09a88f;
}

.quadrant-preview {
  display: grid;
  gap: 0.68rem;
  list-style: none;
  margin: 0.85rem 0 0;
  padding: 0;
}

.quadrant-preview li {
  align-items: start;
  display: grid;
  font-size: 0.78rem;
  gap: 0.45rem;
  grid-template-columns: auto minmax(0, 1fr);
  line-height: 1.34;
}

.preview-checkbox {
  border: 2px solid var(--quadrant-color);
  border-radius: 0.32rem;
  height: 1rem;
  margin-top: 0.05rem;
  width: 1rem;
}

.quadrant-card__empty,
.quadrant-card__more {
  color: var(--text-muted);
  font-size: 0.78rem;
  margin: 1rem 0 0;
}

@media (min-width: 720px) {
  .quadrant-grid {
    gap: 1rem;
  }

  .quadrant-card__link {
    padding: 1.25rem;
  }
}
</style>
