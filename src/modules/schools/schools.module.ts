import { Global, Module } from '@nestjs/common';
import { SchoolMembershipService } from './school-membership.service';
import { SchoolsController } from './schools.controller';

@Global()
@Module({
  controllers: [SchoolsController],
  providers: [SchoolMembershipService],
  exports: [SchoolMembershipService],
})
export class SchoolsModule {}
