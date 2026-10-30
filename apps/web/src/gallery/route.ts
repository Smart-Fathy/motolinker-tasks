/** The gallery is at <the portal's address>/__gallery: '/dashboard/__gallery', '/employee/__gallery'. */
export const galleryAt = (pathname: string): boolean => /\/__gallery\/?$/.test(pathname);
