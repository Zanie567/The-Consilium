import type { MetadataRoute } from 'next'
import { SITE_NAME, SITE_DESCRIPTION } from '@/lib/constants'
import { APP_ICON_NAVY, BRAND_NAVY } from '@/lib/brand'

/**
 * Served at /manifest.webmanifest. Gives Android launchers and Chrome's "Add to Home screen"
 * opaque navy icons (see scripts/brand/generate-app-icons.mjs).
 *
 * `display: 'browser'` keeps today's behaviour: a home-screen shortcut opens the site in a normal
 * browser tab. Switching to 'standalone' would make it an app window without browser controls,
 * a separate decision.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: SITE_NAME,
    short_name: 'Consilium',
    description: SITE_DESCRIPTION,
    start_url: '/',
    display: 'browser',
    background_color: APP_ICON_NAVY,
    theme_color: BRAND_NAVY,
    icons: [
      { src: '/brand/app-icon-192-v1.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-512-v1.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/brand/app-icon-maskable-512-v1.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
