import { buildEvent, decodeIdentity, hashUser } from './activity-event';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (payload: unknown) => `Bearer ${b64({ alg: 'RS256' })}.${b64(payload)}.sig`;

describe('decodeIdentity', () => {
  it('elige TEACHER ignorando el grupo del IdP', () => {
    const r = decodeIdentity(jwt({ sub: 's1', 'cognito:groups': ['us-east-1_x_Google', 'TEACHER'] }));
    expect(r).toEqual({ sub: 's1', role: 'TEACHER' });
  });

  it('solo el grupo del IdP cae a TEACHER', () => {
    expect(decodeIdentity(jwt({ sub: 's1', 'cognito:groups': ['us-east-1_x_Google'] })).role).toBe('TEACHER');
  });

  it('sin grupos cae a TEACHER', () => {
    expect(decodeIdentity(jwt({ sub: 's1' })).role).toBe('TEACHER');
  });

  it('gana el primero de la lista blanca por orden', () => {
    expect(decodeIdentity(jwt({ sub: 's1', 'cognito:groups': ['TEACHER', 'ADMIN'] })).role).toBe('ADMIN');
    expect(decodeIdentity(jwt({ sub: 's1', 'cognito:groups': ['ADMIN', 'SUPERADMIN'] })).role).toBe('SUPERADMIN');
  });

  it.each([undefined, '', 'Bearer ', 'Bearer abc', 'Bearer a.b.c', 'abc.def.ghi'])(
    'token ilegible (%p) -> anon',
    (auth) => {
      expect(decodeIdentity(auth as string | undefined)).toEqual({ sub: null, role: 'none' });
    },
  );

  it('token sin sub -> anon', () => {
    expect(decodeIdentity(jwt({ 'cognito:groups': ['ADMIN'] }))).toEqual({ sub: null, role: 'none' });
  });
});

describe('hashUser', () => {
  it('12 hex, estable y dependiente de la sal', () => {
    const h = hashUser('abc', 's');
    expect(h).toMatch(/^[0-9a-f]{12}$/);
    expect(hashUser('abc', 's')).toBe(h);
    expect(hashUser('abc', 'otra')).not.toBe(h);
  });
});

describe('buildEvent', () => {
  const base = { method: 'GET', route: '/api/x/:id', status: 200, latencyMs: 12, salt: 'sal' };

  it('sin sub -> anon / none', () => {
    const e = buildEvent({ ...base });
    expect(e.user).toBe('anon');
    expect(e.role).toBe('none');
  });

  it('route undefined -> (sin ruta)', () => {
    expect(buildEvent({ ...base, route: undefined }).route).toBe('(sin ruta)');
  });

  it('arma el contrato y no filtra sub ni email', () => {
    const now = new Date('2026-11-19T10:00:00.123Z');
    const e = buildEvent({
      ...base,
      now,
      authorization: jwt({ sub: 'SUB-SECRETO', email: 'a@b.cl', 'cognito:groups': ['ADMIN'] }),
    });
    expect(e).toMatchObject({
      v: 1,
      type: 'http_request',
      ts: '2026-11-19T10:00:00.123Z',
      role: 'ADMIN',
      method: 'GET',
      route: '/api/x/:id',
      status: 200,
      latency_ms: 12,
    });
    expect(e.user).toMatch(/^[0-9a-f]{12}$/);
    const json = JSON.stringify(e);
    expect(json).not.toContain('SUB-SECRETO');
    expect(json).not.toContain('a@b.cl');
  });
});
