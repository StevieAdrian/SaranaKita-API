import { Global, Module } from '@nestjs/common';
import { UserRoleService } from './user-role.service';

@Global()
@Module({
  providers: [UserRoleService],
  exports: [UserRoleService],
})
export class RolesModule {}
