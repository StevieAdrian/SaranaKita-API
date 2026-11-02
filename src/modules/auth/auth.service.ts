import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { Session, User } from '@supabase/supabase-js';
import { SupabaseService } from '../../supabase/supabase.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import type { UserRole } from '../../common/utils/resolve-role';
import { UserRoleService } from '../roles/user-role.service';
import { SignInDto } from './dto/sign-in.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { CompleteGoogleProfileDto } from './dto/complete-google-profile.dto';
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
      .select('id, is_verified')
      .ilike('username', clean)
      .limit(1);

    if (error) {
      this.logger.error(`Gagal memeriksa ketersediaan username "${clean}": ${error.message}`);
      return { available: false, username: clean };
    }

    const existing = data?.[0];
    return { available: !existing || !existing.is_verified, username: clean };
  }

  async checkEmail(email: string): Promise<{ available: boolean; email: string }> {
    const clean = email.trim().toLowerCase();
    if (!clean) {
      return { available: false, email: clean };
    }
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .select('id, is_verified')
      .eq('email', clean)
      .limit(1);

    if (error) {
      this.logger.error(`Gagal memeriksa ketersediaan email "${clean}": ${error.message}`);
      return { available: false, email: clean };
    }

    const existing = data?.[0];
    return { available: !existing || !existing.is_verified, email: clean };
  }

  async register(dto: RegisterDto): Promise<SignInResponse> {
    const client = this.supabaseService.getAdminClient();
    const email = dto.email.trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    const fullName = `${dto.firstName.trim()} ${(dto.lastName || '').trim()}`.trim();

    const { data: existingUsers } = await client
      .from('user')
      .select('id, email, username, is_verified')
      .or(`username.ilike.${username},email.eq.${email}`);

    if (existingUsers && existingUsers.length > 0) {
      for (const existing of existingUsers) {
        if (!existing.is_verified) {
          this.logger.log(
            `Menghapus akun pendaftaran lama yang belum diverifikasi: ID=${existing.id}, email=${existing.email}, username=${existing.username}`,
          );
          try {
            await client.from('siswa').delete().eq('user_id', existing.id);
            await client.from('profile').delete().eq('user_id', existing.id);
            await client.from('user').delete().eq('id', existing.id);
            await client.auth.admin.deleteUser(existing.id);
          } catch (cleanErr: any) {
            this.logger.warn(`Tidak dapat menghapus data akun lama yang belum diverifikasi: ${cleanErr?.message}`);
          }
        } else {
          if (existing.email === email) {
            throw new BadRequestException('Email sudah terdaftar');
          }
          throw new BadRequestException('Username sudah digunakan');
        }
      }
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
      email_confirm: false,
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
      this.logger.error(`Gagal membuat akun autentikasi untuk ${email}: ${authRes.error?.message}`);
      const rawMsg = (authRes.error?.message ?? '').toLowerCase();
      let indonesianMsg = 'Gagal memproses pendaftaran akun. Silakan coba beberapa saat lagi.';
      if (rawMsg.includes('already') || rawMsg.includes('registered')) {
        indonesianMsg = 'Email sudah terdaftar dalam sistem.';
      } else if (rawMsg.includes('password')) {
        indonesianMsg = 'Kata sandi tidak memenuhi kriteria (minimal 8 karakter).';
      }
      throw new BadRequestException(indonesianMsg);
    }

    const userId = authRes.data.user.id;

    const { error: userError } = await client.from('user').upsert({
      id: userId,
      email,
      username,
      role_id: roleId,
      is_verified: false,
    });

    if (userError) {
      this.logger.error(`Gagal menyimpan data pengguna: ${email}: ${userError.message}`);
      throw new BadRequestException('Terjadi kendala saat menyimpan data akun pengguna. Silakan coba lagi.');
    }

    const { error: profileError } = await client.from('profile').upsert({
      user_id: userId,
      full_name: fullName,
      class: dto.class,
      dob: dto.dateOfBirth,
      profile_pict: dto.avatarUrl ?? null,
    });

    if (profileError) {
      this.logger.error(`Gagal menyimpan data profil pengguna untuk ${email}: ${profileError.message}`);
      throw new BadRequestException('Terjadi kendala saat menyimpan data profil pengguna. Silakan coba lagi.');
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

    try {
      const anonClient = this.supabaseService.createAnonClient();
      const { error: resendError } = await anonClient.auth.resend({
        type: 'signup',
        email,
      });
      if (resendError) {
        this.logger.warn(
          `Pengiriman email OTP pendaftaran ke ${email} terkendala: ${resendError.message}`,
        );
      } else {
        this.logger.log(`Email OTP pendaftaran berhasil dikirimkan ke ${email}`);
      }
    } catch (err: any) {
      this.logger.warn(`Terjadi kendala saat mengirimkan email OTP ke ${email}: ${err?.message}`);
    }

    return this.signIn({ email, password: dto.password });
  }

  async resendOtp(
    email: string,
    type: 'signup' | 'recovery' = 'signup',
  ): Promise<{ success: boolean; message: string }> {
    const cleanEmail = (email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new BadRequestException('Email wajib diisi.');
    }
    const anonClient = this.supabaseService.createAnonClient();
    if (type === 'recovery') {
      const { error } = await anonClient.auth.resetPasswordForEmail(cleanEmail);
      if (error) {
        this.logger.warn(`Gagal mengirim ulang kode OTP pemulihan ke ${cleanEmail}: ${error.message}`);
        const rawMsg = (error.message || '').toLowerCase();
        if (rawMsg.includes('security') || rawMsg.includes('rate limit')) {
          throw new BadRequestException('Terlalu banyak permintaan. Silakan tunggu beberapa saat sebelum mencoba lagi.');
        }
        throw new BadRequestException('Gagal mengirim ulang kode OTP pemulihan kata sandi.');
      }
    } else {
      const { error } = await anonClient.auth.resend({
        type: 'signup',
        email: cleanEmail,
      });
      if (error) {
        this.logger.warn(`Gagal mengirim ulang kode OTP pendaftaran ke ${cleanEmail}: ${error.message}`);
        const rawMsg = (error.message || '').toLowerCase();
        if (rawMsg.includes('security') || rawMsg.includes('rate limit')) {
          throw new BadRequestException('Terlalu banyak permintaan. Silakan tunggu beberapa saat sebelum mencoba lagi.');
        }
        throw new BadRequestException('Gagal mengirim ulang kode OTP pendaftaran.');
      }
    }
    return { success: true, message: 'Kode OTP telah berhasil dikirim ulang ke email Anda.' };
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<{ success: boolean; message: string }> {
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new BadRequestException('Email wajib diisi.');
    }

    const client = this.supabaseService.getAdminClient();
    const { data: userRows, error } = await client
      .from('user')
      .select('id, email, is_delete, is_active, is_verified')
      .ilike('email', cleanEmail)
      .limit(1);

    if (error) {
      this.logger.error(`Gagal memeriksa akun untuk lupa kata sandi (${cleanEmail}): ${error.message}`);
      throw new BadRequestException('Terjadi kendala saat memeriksa data akun. Silakan coba beberapa saat lagi.');
    }

    const foundUser = (userRows as Array<{ id: string; email: string; is_delete?: boolean; is_active?: boolean; is_verified?: boolean }> | null)?.[0];

    if (!foundUser) {
      throw new NotFoundException('Email tidak terdaftar dalam sistem.');
    }

    if (foundUser.is_delete === true) {
      throw new BadRequestException('Akun telah dihapus.');
    }

    if (foundUser.is_active === false) {
      throw new BadRequestException('Akun Anda telah dinonaktifkan. Silakan hubungi Administrator.');
    }

    if (foundUser.is_verified === false) {
      throw new BadRequestException('Akun belum diverifikasi. Silakan lakukan aktivasi pendaftaran terlebih dahulu.');
    }

    const anonClient = this.supabaseService.createAnonClient();
    const { error: resetError } = await anonClient.auth.resetPasswordForEmail(cleanEmail);

    if (resetError) {
      this.logger.warn(`Gagal memicu email pemulihan kata sandi untuk ${cleanEmail}: ${resetError.message}`);
      const rawMsg = (resetError.message || '').toLowerCase();
      if (rawMsg.includes('security') || rawMsg.includes('rate limit')) {
        throw new BadRequestException('Terlalu banyak permintaan. Silakan tunggu beberapa saat sebelum mencoba lagi.');
      }
      throw new BadRequestException('Gagal memproses pemulihan kata sandi. Silakan coba lagi nanti.');
    }

    this.logger.log(`Kode OTP pemulihan kata sandi berhasil dikirim ke ${cleanEmail}`);
    return {
      success: true,
      message: 'Kode OTP pemulihan kata sandi telah dikirim ke email Anda.',
    };
  }

  async resetPassword(dto: ResetPasswordDto): Promise<{ success: boolean; message: string }> {
    const cleanEmail = (dto.email || '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new BadRequestException('Email wajib diisi.');
    }

    const client = this.supabaseService.getAdminClient();
    const { data: userRows, error } = await client
      .from('user')
      .select('id, email, is_delete, is_active, is_verified')
      .ilike('email', cleanEmail)
      .limit(1);

    if (error || !userRows || userRows.length === 0) {
      throw new NotFoundException('Pengguna tidak ditemukan.');
    }

    const foundUser = userRows[0];
    if (foundUser.is_delete === true || foundUser.is_active === false) {
      throw new BadRequestException('Akun tidak aktif.');
    }

    const { error: authUpdateError } = await client.auth.admin.updateUserById(foundUser.id, {
      password: dto.newPassword,
    });

    if (authUpdateError) {
      const { data: authData } = await client.auth.admin.listUsers();
      const matchedAuthUser = (authData?.users as any[])?.find(
        (u: any) => (u?.email || '').toLowerCase() === cleanEmail,
      );

      if (matchedAuthUser) {
        const { error: retryError } = await client.auth.admin.updateUserById(matchedAuthUser.id, {
          password: dto.newPassword,
        });
        if (retryError) {
          this.logger.error(`Gagal memperbarui kata sandi di auth.users untuk ${cleanEmail}: ${retryError.message}`);
          throw new BadRequestException('Gagal memperbarui kata sandi.');
        }
      } else {
        this.logger.error(`Gagal memperbarui kata sandi di Supabase Auth untuk ${cleanEmail}: ${authUpdateError.message}`);
        const rawMsg = (authUpdateError.message || '').toLowerCase();
        let errorMsg = 'Gagal memperbarui kata sandi. Pastikan kata sandi baru memenuhi kriteria minimal 8 karakter.';
        if (rawMsg.includes('same password')) {
          errorMsg = 'Kata sandi baru tidak boleh sama dengan kata sandi sebelumnya.';
        }
        throw new BadRequestException(errorMsg);
      }
    }

    this.logger.log(`Kata sandi akun ${cleanEmail} berhasil diupdate.`);
    return {
      success: true,
      message: 'Kata sandi berhasil diupdate. Silakan login kembali dengan kata sandi baru Anda.',
    };
  }

  async signIn(dto: SignInDto): Promise<SignInResponse> {
    const cleanEmail = dto.email.trim().toLowerCase();
    const { data, error } = await this.supabaseService
      .createAnonClient()
      .auth.signInWithPassword({
        email: cleanEmail,
        password: dto.password,
      });

    if (error || !data.session || !data.user) {
      if (error) {
        this.logger.warn(`Login failed untuk ${cleanEmail}: ${error.message}`);
        if (error.message.toLowerCase().includes('email not confirmed')) {
          throw new UnauthorizedException({
            statusCode: 401,
            code: 'EMAIL_NOT_VERIFIED',
            message: 'Email belum diverifikasi. Silakan masukkan kode OTP Anda.',
            email: cleanEmail,
          });
        }
      }
      throw new UnauthorizedException('Email atau kata sandi yang Anda masukkan salah.');
    }

    let isDeletedInDb = false;
    let isInactiveInDb = false;
    let isVerifiedInDb = true;

    if (typeof this.supabaseService.getAdminClient === 'function') {
      try {
        const { data: userRows } = await this.supabaseService
          .getAdminClient()
          .from('user')
          .select('id, is_delete, is_active, is_verified')
          .eq('id', data.user.id)
          .limit(1);

        const foundUser = (userRows as Array<{ is_delete?: boolean; is_active?: boolean; is_verified?: boolean }> | null)?.[0];
        isDeletedInDb = foundUser?.is_delete === true;
        isInactiveInDb = foundUser?.is_active === false;
        if (foundUser && foundUser.is_verified === false) {
          if (data.user?.email_confirmed_at) {
            await this.supabaseService
              .getAdminClient()
              .from('user')
              .update({ is_verified: true })
              .eq('id', data.user.id);
            isVerifiedInDb = true;
          } else {
            isVerifiedInDb = false;
          }
        }
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

    if (!isVerifiedInDb) {
      throw new UnauthorizedException({
        statusCode: 401,
        code: 'EMAIL_NOT_VERIFIED',
        message: 'Email belum diverifikasi. Silakan masukkan kode OTP Anda.',
        email: cleanEmail,
      });
    }

    return this.toSessionResponse(data.session, data.user);
  }

  async refresh(dto: RefreshTokenDto): Promise<SignInResponse> {
    const { data, error } = await this.supabaseService
      .createAnonClient()
      .auth.refreshSession({ refresh_token: dto.refreshToken });

    if (error || !data.session || !data.user) {
      if (error) {
        this.logger.warn(`Pembaruan sesi login (token refresh) gagal: ${error.message}`);
      }
      throw new UnauthorizedException('Sesi login Anda telah berakhir. Silakan masuk kembali.');
    }

    if (typeof this.supabaseService.getAdminClient === 'function') {
      try {
        const { data: dbUserRows } = await this.supabaseService
          .getAdminClient()
          .from('user')
          .select('id, is_active, is_delete, is_verified')
          .eq('id', data.user.id)
          .limit(1);

        const dbUser = dbUserRows?.[0];
        if ((dbUser as any)?.is_verified === false && data.user?.email_confirmed_at) {
          await this.supabaseService
            .getAdminClient()
            .from('user')
            .update({ is_verified: true })
            .eq('id', data.user.id);
        } else if ((dbUser as any)?.is_verified === false) {
          throw new UnauthorizedException(
            'Akun Anda belum diverifikasi. Silakan verifikasi email Anda terlebih dahulu.',
          );
        }
        if (dbUser?.is_delete === true || data.user.user_metadata?.is_delete === true) {
          throw new UnauthorizedException('Akun telah dihapus.');
        }
        if (
          dbUser?.is_active === false ||
          data.user.user_metadata?.is_active === false ||
          data.user.user_metadata?.status === 'inactive'
        ) {
          throw new UnauthorizedException('Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.');
        }
      } catch (err) {
        if (err instanceof UnauthorizedException) {
          throw err;
        }
      }
    }

    return this.toSessionResponse(data.session, data.user);
  }

  async me(user: AuthUser): Promise<MeResponse> {
    const profileName = await this.getProfileFullName(user.id);
    return { user: this.toUserResponse(user, profileName) };
  }

  private async toSessionResponse(
    session: Session,
    user: User,
  ): Promise<SignInResponse> {
    const profileName = await this.getProfileFullName(user.id);
    return {
      tokens: {
        accessToken: session.access_token,
        refreshToken: session.refresh_token,
      },
      user: this.toUserResponse(
        {
          ...user.user_metadata,
          id: user.id,
          email: user.email,
          role: await this.userRoleService.getRole(user.id),
        },
        profileName,
      ),
    };
  }

  private async getProfileFullName(userId: string): Promise<string | null> {
    try {
      const { data } = await this.supabaseService
        .getAdminClient()
        .from('profile')
        .select('full_name')
        .eq('user_id', userId)
        .limit(1);
      const fullName = data?.[0]?.full_name;
      return fullName ? String(fullName).trim() : null;
    } catch {
      return null;
    }
  }

  private toUserResponse(user: UserLike, profileFullName?: string | null): AuthUserResponse {
    const email = user.email ?? '';
    const metaName =
      typeof user.full_name === 'string'
        ? user.full_name
        : typeof user.name === 'string'
          ? user.name
          : '';

    const effectiveName = profileFullName && profileFullName.trim()
      ? profileFullName.trim()
      : metaName.trim();

    return {
      id: user.id,
      email,
      displayName: effectiveName || email.split('@')[0] || 'User',
      role: user.role ?? null,
    };
  }

  async completeGoogleProfile(
    user: AuthUser,
    dto: CompleteGoogleProfileDto,
  ): Promise<MeResponse & { tokens?: { accessToken: string; refreshToken: string } }> {
    const client = this.supabaseService.getAdminClient();
    const userId = user.id;
    const email = (user.email || '').trim().toLowerCase();
    const username = dto.username.trim().toLowerCase();
    const fullName = `${dto.firstName.trim()} ${(dto.lastName || '').trim()}`.trim();

    const { data: existingUsers } = await client
      .from('user')
      .select('id, email, username, is_verified')
      .ilike('username', username)
      .limit(1);

    if (existingUsers && existingUsers.length > 0 && existingUsers[0].id !== userId) {
      const existing = existingUsers[0];
      if (!existing.is_verified) {
        try {
          await client.from('siswa').delete().eq('user_id', existing.id);
          await client.from('profile').delete().eq('user_id', existing.id);
          await client.from('user').delete().eq('id', existing.id);
          await client.auth.admin.deleteUser(existing.id);
        } catch { }
      } else {
        throw new BadRequestException('Username sudah digunakan.');
      }
    }

    const { error: pwdErr } = await client.auth.admin.updateUserById(userId, {
      ...(dto.password ? { password: dto.password } : {}),
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        first_name: dto.firstName.trim(),
        last_name: (dto.lastName || '').trim() || undefined,
        phone: dto.phone.trim(),
        gender: (dto.gender || '').trim().toLowerCase() === 'female' || (dto.gender || '').trim().toLowerCase() === 'perempuan' ? 'Perempuan' : 'Laki-Laki',
        is_delete: false,
        is_active: true,
        status: 'active',
      },
    });
    if (pwdErr && dto.password) {
      this.logger.error(`Gagal memperbarui kata sandi akun Google untuk ${email}: ${pwdErr.message}`);
      throw new BadRequestException('Kata sandi tidak memenuhi kriteria minimal 8 karakter.');
    }

    const roleId = await this.userRoleService.getRoleId('siswa');

    const { error: userError } = await client.from('user').upsert({
      id: userId,
      email,
      username,
      role_id: roleId,
      is_verified: true,
      is_active: true,
      is_delete: false,
    });

    if (userError) {
      this.logger.error(`Gagal menyimpan data akun Google pengguna (${email}): ${userError.message}`);
      throw new BadRequestException('Gagal menyimpan data akun. Silakan coba lagi.');
    }

    const { error: profileError } = await client.from('profile').upsert({
      user_id: userId,
      full_name: fullName,
      class: dto.class,
      dob: dto.dateOfBirth,
      profile_pict: dto.avatarUrl ?? null,
    });

    if (profileError) {
      this.logger.error(`Gagal menyimpan profil akun Google untuk ${email}: ${profileError.message}`);
      throw new BadRequestException('Gagal menyimpan profil pengguna. Silakan coba lagi.');
    }

    const { data: defaultSchools } = await client
      .from('school')
      .select('id')
      .limit(1);
    const schoolId = defaultSchools?.[0]?.id;
    let freshTokens: { accessToken: string; refreshToken: string } | undefined;
    if (dto.password && typeof this.supabaseService.createAnonClient === 'function') {
      try {
        const { data: signInData } = await this.supabaseService
          .createAnonClient()
          .auth.signInWithPassword({
            email,
            password: dto.password,
          });
        if (signInData?.session) {
          freshTokens = {
            accessToken: signInData.session.access_token,
            refreshToken: signInData.session.refresh_token,
          };
        }
      } catch { }
    }
    if (schoolId) {
      await client.from('siswa').upsert({
        user_id: userId,
        school_id: schoolId,
      });
    }

    return {
      ...(freshTokens ? { tokens: freshTokens } : {}),
      user: {
        id: userId,
        email,
        username,
        displayName: fullName,
        role: 'siswa',
      },
    };
  }
}
