import { MetadataRoute } from 'next'
import { SITE_URL } from '@/lib/constants'

export default function robots(): MetadataRoute.Robots {
  if (process.env.TESTING_MODE_ENABLED === '1') return { rules: { userAgent: '*', disallow: '/' } }
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/editorial/', '/admin/', '/api/', '/profile'],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  }
}
