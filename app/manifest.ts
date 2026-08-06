import type { MetadataRoute } from 'next';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Kvitto',
    short_name: 'Kvitto',
    description: 'Receipt scanner with price history',
    start_url: '/',
    display: 'standalone',
    background_color: '#f9fafb',
    theme_color: '#16a34a',
    orientation: 'any',
    categories: ['finance', 'shopping'],
    icons: [
      {
        src: '/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'any',
      },
      {
        src: '/icon-maskable-512.png',
        sizes: '512x512',
        type: 'image/png',
        purpose: 'maskable',
      },
    ],
  };
}
