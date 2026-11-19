import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ActivityModule } from './infrastructure/activity/activity.module';
import { ActivityMiddleware } from './infrastructure/activity/activity.middleware';
import { ConfigModule } from '@nestjs/config';
import { HealthController } from './health.controller';
import { MicroserviceClientModule } from './infrastructure/microservice-client/microservice.module';
import { AuthModule } from './modules/auth/auth.module';
import { ColegiosModule } from './modules/colegios/colegios.module';
import { ProfessorsModule } from './modules/professors/professors.module';
import { StudentsModule } from './modules/students/students.module';
import { JobsModule } from './modules/jobs/jobs.module';
import { AdminModule } from './modules/admin/admin.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MicroserviceClientModule,
    ActivityModule,
    AuthModule,
    ColegiosModule,
    ProfessorsModule,
    StudentsModule,
    JobsModule,
    AdminModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule implements NestModule {
  configure(c: MiddlewareConsumer) {
    c.apply(ActivityMiddleware).forRoutes('*');
  }
}
