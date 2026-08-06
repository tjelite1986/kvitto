import { withAuth } from 'next-auth/middleware';

export default withAuth({
  pages: {
    signIn: '/login',
  },
});

export const config = {
  // Every public asset must be listed by name, otherwise withAuth 307s it to
  // /login and the icon silently disappears. icon.svg stays for PWAs that were
  // installed before the PNG icon set replaced it.
  matcher: [
    '/((?!login|api/auth|_next/static|_next/image|favicon.ico|favicon-32.png|apple-touch-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|icon.svg|manifest.webmanifest|sw.js).*)',
  ],
};
