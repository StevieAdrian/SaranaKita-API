import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { UserRoleService } from '../../modules/roles/user-role.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly userRoleService: UserRoleService,
    private readonly reflector: Reflector,
  ) { }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest();
    const token = this.extractToken(request);

    if (!token) {
      throw new UnauthorizedException('Missing access token');
    }

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .auth.getUser(token);

    if (error || !data?.user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const authMetadata = data.user.user_metadata;
    if (authMetadata?.is_delete === true) {
      throw new UnauthorizedException('Akun telah dihapus.');
    }
    if (authMetadata?.is_active === false || authMetadata?.status === 'inactive') {
      throw new UnauthorizedException('Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.');
    }

    if (typeof (this.supabaseService.getAdminClient() as any)?.from === 'function') {
      try {
        const { data: dbUserRows } = await (
          this.supabaseService.getAdminClient() as any
        )
          .from('user')
          .select('id, is_active, is_delete, is_verified')
          .eq('id', data.user.id)
          .limit(1);

        const dbUser = dbUserRows?.[0];

        if (dbUser) {
          if (dbUser.is_delete === true) {
            throw new UnauthorizedException('Akun telah dihapus.');
          }
          if (dbUser.is_active === false) {
            throw new UnauthorizedException('Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.');
          }
          if (dbUser.is_verified === false && data.user.email_confirmed_at) {
            await (this.supabaseService.getAdminClient() as any)
              .from('user')
              .update({ is_verified: true })
              .eq('id', data.user.id);
          }
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
      }
    }

    const authUser: AuthUser = {
      ...data.user.user_metadata,
      id: data.user.id,
      email: data.user.email,
      role: await this.userRoleService.getRole(data.user.id),
    };

    request.user = authUser;
    request.accessToken = token;

    return true;
  }

  private extractToken(request: {
    headers: Record<string, string | undefined>;
  }): string | null {
    const authHeader = request.headers.authorization;

    if (!authHeader) {
      return null;
    }

    const [type, token] = authHeader.split(' ');
    return type === 'Bearer' && token ? token : null;
  }
}
