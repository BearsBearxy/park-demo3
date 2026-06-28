import { createRouter, createWebHistory } from 'vue-router'
import { fpBuildRoutes } from '@/nav/fpNav'

const PlaceholderView = () => import('@/views/PlaceholderView.vue')
const Gallery = () => import('@/views/Gallery.vue')

const navRoutes = fpBuildRoutes()

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/data-home' },
    { path: '/_gallery', component: Gallery },
    ...Object.values(navRoutes).map(meta => ({
      path: `/${meta.value}`,
      component: PlaceholderView,
      meta,
    })),
  ],
})

export default router
