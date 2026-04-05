import { MetadataRoute } from 'next'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/editorial/', '/admin/', '/api/', '/profile'],
      },
    ],
    sitemap: 'https://the-consilium.vercel.app/sitemap.xml',
  }
}
