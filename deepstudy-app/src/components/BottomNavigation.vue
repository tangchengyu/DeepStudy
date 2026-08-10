<script setup lang="ts">
import { RouterLink, useRoute } from 'vue-router'
import { primaryTabs } from '../router/routes'
import AppIcon from './AppIcon.vue'

const route = useRoute()
</script>

<template>
  <nav class="bottom-nav" aria-label="主导航">
    <div class="bottom-nav__inner">
      <RouterLink
        v-for="tab in primaryTabs"
        :key="tab.path"
        :to="tab.path"
        class="bottom-nav__item"
        :class="{
          'bottom-nav__item--active': tab.matches(route.path),
          'bottom-nav__item--focus': tab.icon === 'focus',
        }"
        :aria-current="tab.matches(route.path) ? 'page' : undefined"
        data-testid="bottom-nav-item"
      >
        <span class="bottom-nav__icon"><AppIcon :name="tab.icon" /></span>
        <span>{{ tab.label }}</span>
      </RouterLink>
    </div>
  </nav>
</template>

<style scoped>
.bottom-nav {
  bottom: 0;
  left: 0;
  padding: 0 0 max(0.5rem, env(safe-area-inset-bottom));
  pointer-events: none;
  position: fixed;
  right: 0;
  z-index: 20;
}

.bottom-nav__inner {
  align-items: end;
  background: color-mix(in srgb, var(--surface) 96%, transparent);
  border: 1px solid var(--border-soft);
  border-bottom: 0;
  border-radius: 1.15rem 1.15rem 0 0;
  box-shadow: 0 -0.55rem 1.8rem rgb(44 62 56 / 10%);
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  margin: 0 auto;
  max-width: 48rem;
  min-height: 4.55rem;
  padding: 0.38rem 0.35rem 0.3rem;
  pointer-events: auto;
}

.bottom-nav__item {
  align-items: center;
  border-radius: 0.9rem;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  font-size: 0.7rem;
  font-weight: 650;
  gap: 0.2rem;
  justify-content: center;
  min-height: 3.6rem;
  min-width: 0;
  text-decoration: none;
  transition: color 180ms ease, background-color 180ms ease;
}

.bottom-nav__item--active {
  color: var(--accent);
}

.bottom-nav__item:not(.bottom-nav__item--focus):hover {
  background: var(--surface-muted);
}

.bottom-nav__item:focus-visible {
  outline: 3px solid var(--focus-ring);
  outline-offset: 1px;
}

.bottom-nav__icon {
  align-items: center;
  display: inline-flex;
  height: 1.75rem;
  justify-content: center;
  width: 1.75rem;
}

.bottom-nav__item--focus {
  color: var(--accent);
  transform: translateY(-0.52rem);
}

.bottom-nav__item--focus .bottom-nav__icon {
  background: linear-gradient(180deg, #7db7a4, var(--accent));
  border: 0.3rem solid var(--background);
  border-radius: 999px;
  box-shadow: 0 0.55rem 1.1rem rgb(86 143 124 / 24%);
  color: #fff;
  height: 3.25rem;
  width: 3.25rem;
}

@media (prefers-reduced-motion: reduce) {
  .bottom-nav__item {
    transition: none;
  }
}
</style>
