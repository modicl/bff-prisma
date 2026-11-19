import { EventEmitter } from 'events';
import { ActivityMiddleware } from './activity.middleware';
import { ActivityPublisher } from './activity-publisher.service';
import { ConfigService } from '@nestjs/config';

const mk = (publish: jest.Mock, env: Record<string, string> = {}) =>
  new ActivityMiddleware(
    { publish } as unknown as ActivityPublisher,
    { get: (k: string) => env[k] } as unknown as ConfigService,
  );
const res = (status = 200) => Object.assign(new EventEmitter(), { statusCode: status });

describe('ActivityMiddleware', () => {
  it('publica una vez al terminar la respuesta, con la plantilla de ruta', () => {
    const publish = jest.fn();
    const req: any = { method: 'GET', originalUrl: '/api/students/123?x=1', headers: {} };
    const r = res(200);
    const next = jest.fn();
    mk(publish).use(req, r as any, next);
    expect(next).toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
    req.route = { path: '/api/students/:id' };
    r.emit('finish');
    r.emit('finish');
    expect(publish).toHaveBeenCalledTimes(1);
    const e = publish.mock.calls[0][0];
    expect(e).toMatchObject({ method: 'GET', status: 200, route: '/api/students/:id', user: 'anon', role: 'none' });
    expect(e.latency_ms).toBeGreaterThanOrEqual(0);
  });

  it('no publica /health (con o sin query)', () => {
    const publish = jest.fn();
    for (const url of ['/health', '/health?x=1']) {
      const r = res();
      mk(publish).use({ method: 'GET', originalUrl: url, headers: {} } as any, r as any, jest.fn());
      r.emit('finish');
    }
    expect(publish).not.toHaveBeenCalled();
  });

  it('sin req.route usa "(sin ruta)", nunca la URL', () => {
    const publish = jest.fn();
    const r = res(404);
    mk(publish).use({ method: 'GET', originalUrl: '/api/zzz/987', headers: {} } as any, r as any, jest.fn());
    r.emit('finish');
    expect(publish.mock.calls[0][0].route).toBe('(sin ruta)');
    expect(publish.mock.calls[0][0].status).toBe(404);
  });

  it('si el publisher lanza, no propaga el error', () => {
    const publish = jest.fn(() => { throw new Error('x'); });
    const r = res();
    mk(publish).use({ method: 'GET', originalUrl: '/a', headers: {} } as any, r as any, jest.fn());
    expect(() => r.emit('finish')).not.toThrow();
  });
});
