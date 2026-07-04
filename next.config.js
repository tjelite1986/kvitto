/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: {
    serverComponentsExternalPackages: ['better-sqlite3', 'sharp'],
    // Under QEMU emulation (CI arm64 build) the V8 JIT in forked build
    // workers randomly hits SIGILL; single-worker mode avoids it.
    ...(process.env.CI_LIMIT_WORKERS === '1' ? { cpus: 1, workerThreads: false } : {}),
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
