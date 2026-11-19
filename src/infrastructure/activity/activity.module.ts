import { Module } from '@nestjs/common';
import { ActivityMiddleware } from './activity.middleware';
import { ActivityPublisher } from './activity-publisher.service';

@Module({
  providers: [ActivityPublisher, ActivityMiddleware],
  exports: [ActivityPublisher, ActivityMiddleware],
})
export class ActivityModule {}
