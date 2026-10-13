import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevRoleService } from './dev-role.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, DevRoleService],
})
export class AuthModule {}
