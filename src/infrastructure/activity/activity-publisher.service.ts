import { Inject, Injectable, Logger, Optional, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ActivityEvent } from './activity-event';

export interface ActivityProducer {
  connect(): Promise<void>;
  send(a: { topic: string; messages: { value: string }[] }): Promise<unknown>;
  disconnect(): Promise<void>;
}

const DEFAULT_TOPIC = 'prisma.activity-events';
const QUEUE_MAX = 1000;
const BATCH_MAX = 100;
const SEND_TIMEOUT_MS = 5000;
const CLOSE_DRAIN_MS = 3000;
const WARN_EVERY = 100;
const RETRY_BASE_MS = 1000;
const RETRY_MAX_MS = 30000;

/**
 * Publica eventos de actividad a Kafka sin que el BFF dependa de Kafka:
 * publish() solo encola (síncrono, nunca lanza); un bucle en segundo plano envía.
 * Cola acotada: si Kafka está caído o lento se descarta lo más nuevo y se cuenta.
 */
@Injectable()
export class ActivityPublisher implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(ActivityPublisher.name);
  private readonly bootstrap: string;
  private readonly topic: string;
  private readonly factory: () => ActivityProducer;
  private queue: ActivityEvent[] = [];
  private producer: ActivityProducer | null = null;
  private worker: Promise<void> | null = null;
  private closing = false;
  private wake: (() => void) | null = null;
  readonly stats = { sent: 0, dropped: 0 };

  constructor(
    config: ConfigService,
    @Optional() @Inject('ACTIVITY_PRODUCER_FACTORY') producerFactory?: () => ActivityProducer,
  ) {
    this.bootstrap = (config.get<string>('KAFKA_BOOTSTRAP_SERVERS') ?? '').trim();
    this.topic = (config.get<string>('KAFKA_ACTIVITY_TOPIC') ?? '').trim() || DEFAULT_TOPIC;
    this.factory = producerFactory ?? (() => this.defaultProducer());
  }

  get enabled(): boolean {
    return this.bootstrap !== '';
  }

  onModuleInit(): void {
    this.logger.log(
      this.enabled
        ? `Actividad -> Kafka ${this.bootstrap} topic ${this.topic}`
        : 'Actividad desactivada (sin KAFKA_BOOTSTRAP_SERVERS)',
    );
  }

  publish(e: ActivityEvent): void {
    try {
      if (!this.enabled || this.closing) return;
      if (this.queue.length >= QUEUE_MAX) {
        this.drop('cola llena');
        return;
      }
      this.queue.push(e);
      this.ensureWorker();
    } catch {
      // nunca debe afectar a la respuesta HTTP
    }
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    this.wake?.();
    if (this.worker) {
      await this.sleep(CLOSE_DRAIN_MS, this.worker);
    }
    if (this.producer) {
      const p = this.producer;
      this.producer = null;
      await this.sleep(SEND_TIMEOUT_MS, p.disconnect().catch(() => undefined));
    }
  }

  // ── internos ──────────────────────────────────────────────────────────────
  private drop(motivo: string, n = 1): void {
    const before = this.stats.dropped;
    this.stats.dropped += n;
    if (before === 0 || Math.floor(this.stats.dropped / WARN_EVERY) > Math.floor(before / WARN_EVERY)) {
      this.logger.warn(`evento de actividad descartado (${motivo}); descartados en total: ${this.stats.dropped}`);
    }
  }

  private ensureWorker(): void {
    if (this.worker) return;
    this.worker = this.run()
      .catch(() => undefined)
      .finally(() => {
        this.worker = null;
        if (this.queue.length > 0 && !this.closing) this.ensureWorker();
      });
  }

  /** Espera ms o a que `until` termine (o a onModuleDestroy). No retiene el proceso. */
  private sleep(ms: number, until?: Promise<unknown>): Promise<void> {
    return new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      t.unref();
      const done = () => {
        clearTimeout(t);
        resolve();
      };
      if (until) until.then(done, done);
      else this.wake = done;
    });
  }

  private async connect(): Promise<void> {
    let attempt = 0;
    while (!this.producer && !this.closing) {
      try {
        const p = this.factory();
        await p.connect();
        this.producer = p;
      } catch (err) {
        attempt += 1;
        const wait = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (attempt - 1));
        if (attempt === 1 || attempt % 10 === 0) {
          this.logger.warn(`Kafka no disponible (${(err as Error)?.message}); reintento en ${wait / 1000}s`);
        }
        await this.sleep(wait);
      }
    }
  }

  private async run(): Promise<void> {
    await this.connect();
    while (this.queue.length > 0 && this.producer) {
      const batch = this.queue.splice(0, BATCH_MAX);
      let timer: NodeJS.Timeout | undefined;
      try {
        const sending = this.producer.send({
          topic: this.topic,
          messages: batch.map((e) => ({ value: JSON.stringify(e) })),
        });
        sending.catch(() => undefined);
        const timeout = new Promise<never>((_, rej) => {
          timer = setTimeout(() => rej(new Error('timeout de envío')), SEND_TIMEOUT_MS);
          timer.unref();
        });
        await Promise.race([sending, timeout]);
        this.stats.sent += batch.length;
      } catch (err) {
        this.drop(`${(err as Error)?.message}`, batch.length);
      } finally {
        clearTimeout(timer);
      }
    }
  }

  private defaultProducer(): ActivityProducer {
    // import perezoso: sin Kafka configurado ni siquiera se carga kafkajs
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { Kafka, logLevel } = require('kafkajs');
    const kafka = new Kafka({
      clientId: 'bff-prisma',
      brokers: this.bootstrap
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean),
      logLevel: logLevel.NOTHING,
      connectionTimeout: 3000,
      requestTimeout: 5000,
      retry: { retries: 2, initialRetryTime: 300 },
    });
    const producer = kafka.producer({ allowAutoTopicCreation: true });
    return {
      connect: () => producer.connect(),
      send: (a) => producer.send(a),
      disconnect: () => producer.disconnect(),
    };
  }
}
