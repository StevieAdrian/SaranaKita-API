import { timingSafeEqual } from 'crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { UserRoleService } from '../roles/user-role.service';
import { SwitchRoleDto } from './dto/switch-role.dto';

@Injectable()
export class DevRoleService {
  private readonly logger = new Logger(DevRoleService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly supabaseService: SupabaseService,
    private readonly userRoleService: UserRoleService,
  ) {}

  async switchRole(
    user: AuthUser,
    dto: SwitchRoleDto,
  ): Promise<{ role: string }> {
    if (this.configService.get<string>('nodeEnv') === 'production') {
      throw new NotFoundException();
    }

    const expected = this.configService.get<string>('bypassRolePassword');
    if (!expected) {
      throw new NotFoundException();
    }
    if (!this.matches(dto.password, expected)) {
      throw new UnauthorizedException('Invalid bypass password');
    }

    if (dto.email.trim().toLowerCase() !== (user.email ?? '').toLowerCase()) {
      throw new ForbiddenException(
        'Email tidak sesuai dengan akun yang login.',
      );
    }

    const roleId = await this.userRoleService.getRoleId(dto.role);
    const { error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .update({ role_id: roleId })
      .eq('id', user.id);

    if (error) {
      throw error;
    }

    this.logger.warn(`[DEV] Role switch: ${user.id} -> ${dto.role}`);
    return { role: dto.role };
  }

  private matches(input: string, expected: string): boolean {
    const a = Buffer.from(input);
    const b = Buffer.from(expected);
    return a.length === b.length && timingSafeEqual(a, b);
  }
}
