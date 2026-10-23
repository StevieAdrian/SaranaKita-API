import { BadRequestException, Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import type { UserRole } from '../../common/utils/resolve-role';
import { UserRoleService } from '../roles/user-role.service';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import type {
  AuthUserResponse,
  MeResponse,
  SignInResponse,
} from './auth.types';

type UserLike = {
  id: string;
  email?: string | null;
  role?: UserRole | null;
  full_name?: unknown;
  name?: unknown;
};

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly userRoleService: UserRoleService,
  ) { }

  async checkUsername(username: string): Promise<{ available: boolean; username: string }> {
    const clean = username.trim().toLowerCase();
    if (!clean || clean.length < 3) {
      return { available: false, username: clean };
    }
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .select('id')
      .ilike('username', clean)
      .limit(1);

    if (error) {
      this.logger.error(`Error checking username "${clean}": ${error.message}`);
      return { available: false, username: clean };
    }

    return { available: !data || data.length === 0, username: clean };
  }

  async checkEmail(email: string): Promise<{ available: boolean; email: string }> {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      return { available: false, email: clean };
    }
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .select('id')
      .eq('email', clean)
      .limit(1);

    if (error) {
      this.logger.error(`Error checking email "${clean}": ${error.message}`);
      return { available: false, email: clean };
    }

    return { available: !data || data.length === 0, email: clean };
  }

  async register(dto: RegisterDto): Promise<SignInResponse> {
    const client = this.supabaseService.getAdminClient();
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    const fullName = `${dto.firstName.trim()} ${(dto.lastName || '').trim()}`.trim();

    const usernameCheck = await this.checkUsername(username);
    if (!usernameCheck.available) {
      throw new BadRequestException('Username sudah digunakan');
    }

    const emailCheck = await this.checkEmail(email);
    if (!emailCheck.available) {
      throw new BadRequestException('Email sudah terdaftar');
    }

    const roleId = await this.userRoleService.getRoleId('siswa');

    let genderLabel = dto.gender;
    const lowerGender = (dto.gender || '').trim().toLowerCase();
    if (lowerGender === 'female' || lowerGender === 'perempuan') {
      genderLabel = 'Perempuan';
    } else if (lowerGender === 'male' || lowerGender === 'laki-laki') {
      genderLabel = 'Laki-Laki';
    }

    const authRes = await client.auth.admin.createUser({
      email,
      password: dto.password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        first_name: dto.firstName.trim(),
        last_name: (dto.lastName || '').trim() || undefined,
        phone: dto.phone,
        gender: genderLabel,
        is_delete: false,
        is_active: true,
        status: 'active',
      },
    });

    if (authRes.error || !authRes.data.user) {
      throw new BadRequestException(
        authRes.error?.message ?? 'Gagal membuat user autentikasi.',
      );
    }

    const userId = authRes.data.user.id;

    const { error: userError } = await client.from('user').upsert({
      id: userId,
      email,
      username,
      password: dto.password,
      role_id: roleId,
      is_verified: true,
    });

    if (userError) {
      throw new BadRequestException(`Gagal menyimpan data pengguna: ${userError.message}`);
    }

    const { error: profileError } = await client.from('profile').upsert({
      user_id: userId,
      full_name: fullName,
      class: dto.class,
      dob: dto.dateOfBirth,
      profile_pict: dto.avatarUrl ?? null,
    });

    if (profileError) {
      throw new BadRequestException(`Gagal menyimpan profil: ${profileError.message}`);
    }

    const { data: defaultSchools } = await client
      .from('school')
      .select('id')
      .limit(1);

    const schoolId = defaultSchools?.[0]?.id;

    if (schoolId) {
      await client.from('siswa').upsert({
        user_id: userId,
        school_id: schoolId,
      });
    }

    return this.signIn({ email, password: dto.password });
  }

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

    let isDeletedInDb = false;
    let isInactiveInDb = false;
    if (typeof this.supabaseService.getAdminClient === 'function') {
      try {
        const { data: userRows } = await this.supabaseService
          .getAdminClient()
          .from('user')
          .select('id, is_delete, is_active')
          .eq('id', data.user.id)
          .limit(1);

        const foundUser = (userRows as Array<{ is_delete?: boolean; is_active?: boolean }> | null)?.[0];
        isDeletedInDb = foundUser?.is_delete === true;
        isInactiveInDb = foundUser?.is_active === false;
      } catch { }
    }
    const isDeletedInMeta = data.user.user_metadata?.is_delete === true;
    const isInactiveInMeta =
      data.user.user_metadata?.is_active === false ||
      data.user.user_metadata?.status === 'inactive';

    if (isDeletedInDb || isDeletedInMeta) {
      throw new UnauthorizedException('Akun telah dihapus.');
    }

    if (isInactiveInDb || isInactiveInMeta) {
      throw new UnauthorizedException('Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.');
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

  private async toSessionResponse(
    session: Session,
    user: User,
  ): Promise<SignInResponse> {
    return {
      tokens: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
      user: this.toUserResponse({
        ...user.user_metadata,
        id: user.id,
        email: user.email,
        role: await this.userRoleService.getRole(user.id),
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
      role: user.role ?? null,
    };
  }
}
