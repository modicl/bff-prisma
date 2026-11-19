import { Injectable, NestMiddleware } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { buildEvent } from './activity-event';
import { ActivityPublisher } from './activity-publisher.service';

@Injectable()
export class ActivityMiddleware implements NestMiddleware {
  constructor(
    private readonly publisher: ActivityPublisher,
    private readonly config: ConfigService,
  ) {}

  use(req: any, res: any, next: () => void): void {
    try {
      const path = String(req.originalUrl ?? req.url ?? '').split('?')[0];
      if (path !== '/health') {
        const start = process.hrtime.bigint();
        let done = false;
        res.on('finish', () => {
          if (done) return;
          done = true;
          try {
            this.publisher.publish(
              buildEvent({
                authorization: req.headers?.authorization,
                method: req.method,
                route: req.route?.path, // recién en 'finish' el router ya la resolvió
                status: res.statusCode,
                latencyMs: Number((process.hrtime.bigint() - start) / 1000000n),
                salt: this.config.get<string>('ACTIVITY_SALT') || 'prisma',
              }),
            );
          } catch {
            // la métrica nunca rompe la respuesta
          }
        });
      }
    } catch {
      // idem
    }
    next();
  }
}
