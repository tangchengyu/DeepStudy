import { createApp } from 'vue'
import App from './App.vue'
import { router } from './router'
import { initializeAppServices } from './services/appServices'
import './styles.css'

createApp(App).use(router).mount('#app')
void initializeAppServices().catch(() => undefined)
