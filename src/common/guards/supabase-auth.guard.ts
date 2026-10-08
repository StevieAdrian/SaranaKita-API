import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { SupabaseService } from '../../supabase/supabase.service';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { AuthUser } from '../interfaces/auth-user.interface';

@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly reflector: Reflector,
  ) {}

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

    const authUser: AuthUser = {
      id: data.user.id,
      email: data.user.email,
      role: (data.user.app_metadata?.role as string) ?? 'user',
      ...data.user.user_metadata,
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
