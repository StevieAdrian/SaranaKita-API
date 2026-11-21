import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsGateway } from './notifications.gateway';
import { NotificationsService } from './notifications.service';
import { FirebaseModule } from '../../firebase/firebase.module';

@Module({
  imports: [FirebaseModule],
  controllers: [NotificationsController],
  providers: [NotificationsGateway, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
