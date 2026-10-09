import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import type {
  AuthUserResponse,
  MeResponse,
  SignInResponse,
} from './auth.types';

type UserLike = {
  id: string;
  email?: string | null;
  full_name?: unknown;
  name?: unknown;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(private readonly supabaseService: SupabaseService) {}

  async signIn(dto: SignInDto): Promise<SignInResponse> {
    const { data, error } = await this.supabaseService
      .createAnonClient()
      .auth.signInWithPassword({
        email: dto.email.trim().toLowerCase(),
        password: dto.password,
      });

    if (error || !data.session || !data.user) {
      if (error) {
        this.logger.warn(`Sign-in failed: ${error.message}`);
      }
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.toSessionResponse(data.session, data.user);
  }

  async refresh(dto: RefreshTokenDto): Promise<SignInResponse> {
    const { data, error } = await this.supabaseService
      .createAnonClient()
      .auth.refreshSession({ refresh_token: dto.refreshToken });

    if (error || !data.session || !data.user) {
      if (error) {
        this.logger.warn(`Token refresh failed: ${error.message}`);
      }
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    return this.toSessionResponse(data.session, data.user);
  }

  me(user: AuthUser): MeResponse {
    return { user: this.toUserResponse(user) };
  }

  private toSessionResponse(session: Session, user: User): SignInResponse {
    return {
      tokens: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
      user: this.toUserResponse({
        id: user.id,
        email: user.email,
        ...user.user_metadata,
      }),
    };
  }

  private toUserResponse(user: UserLike): AuthUserResponse {
    const email = user.email ?? '';
    const metaName =
      typeof user.full_name === 'string'
        ? user.full_name
        : typeof user.name === 'string'
          ? user.name
          : '';

    return {
      id: user.id,
      email,
      displayName: metaName.trim() || email.split('@')[0] || 'User',
    };
  }
}
