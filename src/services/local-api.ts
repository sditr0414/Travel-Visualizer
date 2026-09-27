// Local file and place-service APIs belong to the loopback launcher only.
// Public static sites must not probe paths that their SPA fallback can turn into HTML.
export function canUseLocalApi(hostname = window.location.hostname): boolean {
  return hostname === '127.0.0.1' || hostname === 'localhost';
}

export function isJsonResponse(response: Response): boolean {
  return response.ok && response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() === 'application/json';
}
