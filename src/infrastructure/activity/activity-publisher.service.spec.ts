import { ConfigService } from '@nestjs/config';
import { ActivityPublisher } from './activity-publisher.service';
import { ActivityEvent } from './activity-event';

const ev = (n = 0): ActivityEvent => ({
  v: 1, type: 'http_request', ts: '2026-11-19T00:00:00.000Z', user: 'abc' + n,
  role: 'TEACHER', method: 'GET', route: '/api/x', status: 200, latency_ms: 1,
});
const cfg = (env: Record<string, string>) => ({ get: (k: string) => env[k] } as unknown as ConfigService);
const flush = (ms = 30) => new Promise((r) => setTimeout(r, ms));

describe('ActivityPublisher', () => {
  it('sin KAFKA_BOOTSTRAP_SERVERS queda desactivado y publish no hace nada', async () => {
    const factory = jest.fn();
    const p = new ActivityPublisher(cfg({}), factory);
    await p.onModuleInit();
    expect(p.enabled).toBe(false);
    p.publish(ev());
    await flush();
    expect(factory).not.toHaveBeenCalled();
    expect(p.stats).toEqual({ sent: 0, dropped: 0 });
  });

  it('envía los mensajes publicados como JSON al topic', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const producer = { connect: jest.fn().mockResolvedValue(undefined), send, disconnect: jest.fn().mockResolvedValue(undefined) };
    const p = new ActivityPublisher(cfg({ KAFKA_BOOTSTRAP_SERVERS: 'k:9092' }), () => producer);
    await p.onModuleInit();
    p.publish(ev(1)); p.publish(ev(2)); p.publish(ev(3));
    await flush();
    const msgs = send.mock.calls.flatMap((c) => c[0].messages.map((m: { value: string }) => JSON.parse(m.value)));
    expect(send.mock.calls[0][0].topic).toBe('prisma.activity-events');
    expect(msgs.map((m: ActivityEvent) => m.user)).toEqual(['abc1', 'abc2', 'abc3']);
    expect(p.stats.sent).toBe(3);
    await p.onModuleDestroy();
  });

  it('usa KAFKA_ACTIVITY_TOPIC si está definido', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const producer = { connect: jest.fn().mockResolvedValue(undefined), send, disconnect: jest.fn().mockResolvedValue(undefined) };
    const p = new ActivityPublisher(cfg({ KAFKA_BOOTSTRAP_SERVERS: 'k:9092', KAFKA_ACTIVITY_TOPIC: 'otro' }), () => producer);
    p.publish(ev());
    await flush();
    expect(send.mock.calls[0][0].topic).toBe('otro');
    await p.onModuleDestroy();
  });

  it('con send que nunca resuelve, publish retorna al instante y no lanza', async () => {
    const producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockReturnValue(new Promise(() => undefined)),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const p = new ActivityPublisher(cfg({ KAFKA_BOOTSTRAP_SERVERS: 'k:9092' }), () => producer);
    const t0 = Date.now();
    expect(() => p.publish(ev())).not.toThrow();
    expect(Date.now() - t0).toBeLessThan(50);
    await p.onModuleDestroy();
  });

  it('con send que rechaza, no lanza y cuenta descartados', async () => {
    const producer = {
      connect: jest.fn().mockResolvedValue(undefined),
      send: jest.fn().mockRejectedValue(new Error('boom')),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const p = new ActivityPublisher(cfg({ KAFKA_BOOTSTRAP_SERVERS: 'k:9092' }), () => producer);
    expect(() => p.publish(ev())).not.toThrow();
    await flush();
    expect(p.stats.dropped).toBe(1);
    await p.onModuleDestroy();
  });

  it('con productor trabado y 1500 publish, la cola es acotada (dropped >= 500)', async () => {
    const producer = {
      connect: jest.fn().mockReturnValue(new Promise(() => undefined)),
      send: jest.fn(),
      disconnect: jest.fn().mockResolvedValue(undefined),
    };
    const p = new ActivityPublisher(cfg({ KAFKA_BOOTSTRAP_SERVERS: 'k:9092' }), () => producer);
    for (let i = 0; i < 1500; i++) p.publish(ev(i));
    expect(p.stats.dropped).toBeGreaterThanOrEqual(500);
    await p.onModuleDestroy();
  }, 10000);
});
