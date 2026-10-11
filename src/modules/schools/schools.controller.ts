import { Controller, Get } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SchoolMembershipService } from './school-membership.service';

@Controller('schools')
export class SchoolsController {
  constructor(private readonly schoolMembership: SchoolMembershipService) {}

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.schoolMembership.getSchool(user.id);
  }
}
