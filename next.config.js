/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'sharp'],
  },
  headers: async () => [
    {
      // Prevent caching of HTML pages so a new deploy is visible immediately
      source: '/((?!_next/static|_next/image|favicon|icon|manifest).*)',
      headers: [
        { key: 'Cache-Control', value: 'no-store, must-revalidate' },
      ],
    },
  ],
};

module.exports = nextConfig;
