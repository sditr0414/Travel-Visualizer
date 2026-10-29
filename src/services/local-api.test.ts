import { canUseLocalApi, isJsonResponse } from './local-api';

describe('local server API boundary', () => {
  it('never probes local files from a Pages build, including a loopback preview', () => {
    vi.stubEnv('MODE', 'pages');
    try {
      expect(canUseLocalApi('localhost')).toBe(false);
      expect(canUseLocalApi('127.0.0.1')).toBe(false);
    } finally { vi.unstubAllEnvs(); }
  });

  it('only probes the loopback hostnames supported by the local server', () => {
    expect(canUseLocalApi('localhost')).toBe(true);
    expect(canUseLocalApi('127.0.0.1')).toBe(true);
    for (const hostname of ['travel.example', 'localhost.attacker.example', '192.168.0.2', '']) {
      expect(canUseLocalApi(hostname)).toBe(false);
    }
  });

  it('rejects successful SPA HTML, failed requests and untyped responses', () => {
    expect(isJsonResponse(new Response('{}', { headers: { 'Content-Type': 'application/json; charset=utf-8' } }))).toBe(true);
    expect(isJsonResponse(new Response('<html></html>', { headers: { 'Content-Type': 'text/html' } }))).toBe(false);
    expect(isJsonResponse(new Response('{}', { status: 404, headers: { 'Content-Type': 'application/json' } }))).toBe(false);
    expect(isJsonResponse(new Response('{}'))).toBe(false);
  });
});
