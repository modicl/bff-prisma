import { createHash } from 'crypto';

export type Role = 'SUPERADMIN' | 'ADMIN' | 'TEACHER';

export interface ActivityEvent {
  v: 1;
  type: 'http_request';
  ts: string;
  user: string;
  role: Role | 'none';
  method: string;
  route: string;
  status: number;
  latency_ms: number;
}

// Orden de prioridad: gana el primero de esta lista presente en los grupos.
const ROLES: Role[] = ['SUPERADMIN', 'ADMIN', 'TEACHER'];
const DEFAULT_ROLE: Role = 'TEACHER';

/**
 * Extrae sub y rol del JWT SIN verificar la firma. Es informativo (métricas de
 * uso); la autorización real la hace cada microservicio. Nunca lanza.
 */
export function decodeIdentity(authorization?: string): { sub: string | null; role: Role | 'none' } {
  const anon = { sub: null, role: 'none' as const };
  try {
    if (!authorization) return anon;
    const token = authorization.replace(/^Bearer\s+/i, '').trim();
    const parts = token.split('.');
    if (parts.length !== 3) return anon;
    const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    if (!payload || typeof payload.sub !== 'string' || !payload.sub) return anon;
    const groups: unknown[] = Array.isArray(payload['cognito:groups']) ? payload['cognito:groups'] : [];
    const role = ROLES.find((r) => groups.includes(r)) ?? DEFAULT_ROLE;
    return { sub: payload.sub, role };
  } catch {
    return anon;
  }
}

export function hashUser(sub: string, salt: string): string {
  return createHash('sha256').update(sub + salt).digest('hex').slice(0, 12);
}

export function buildEvent(i: {
  authorization?: string;
  method: string;
  route?: string;
  status: number;
  latencyMs: number;
  salt: string;
  now?: Date;
}): ActivityEvent {
  const { sub, role } = decodeIdentity(i.authorization);
  return {
    v: 1,
    type: 'http_request',
    ts: (i.now ?? new Date()).toISOString(),
    user: sub ? hashUser(sub, i.salt) : 'anon',
    role,
    method: i.method,
    route: i.route || '(sin ruta)',
    status: i.status,
    latency_ms: i.latencyMs,
  };
}
