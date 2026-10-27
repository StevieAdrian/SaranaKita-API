import { UnauthorizedException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserRoleService } from '../roles/user-role.service';
import { AuthService } from './auth.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class { },
}));
jest.mock('../roles/user-role.service', () => ({
  UserRoleService: class { },
}));

const session = { access_token: 'access', refresh_token: 'refresh' };

function setup(
  result: { data: unknown; error: unknown },
  dbRole: string | null,
) {
  const signInWithPassword = jest.fn().mockResolvedValue(result);
  const refreshSession = jest.fn().mockResolvedValue(result);
  const service = {
    createAnonClient: () => ({ auth: { signInWithPassword, refreshSession } }),
  } as unknown as SupabaseService;
  const getRole = jest.fn().mockResolvedValue(dbRole);
  const userRoles = { getRole } as unknown as UserRoleService;
  return { auth: new AuthService(service, userRoles), getRole };
}

describe('AuthService', () => {
  it('returns role from the database on sign-in', async () => {
    const { auth, getRole } = setup(
      {
        data: {
          session,
          user: {
            id: 'u1',
            email: 'guru@sekolah.id',
            user_metadata: { full_name: 'Bu Ani' },
          },
        },
        error: null,
      },
      'guru',
    );

    await expect(
      auth.signIn({ email: 'guru@sekolah.id', password: 'secret' }),
    ).resolves.toEqual({
      tokens: { accessToken: 'access', refreshToken: 'refresh' },
      user: {
        id: 'u1',
        email: 'guru@sekolah.id',
        displayName: 'Bu Ani',
        role: 'guru',
      },
    });
    expect(getRole).toHaveBeenCalledWith('u1');
  });

  it('ignores role, id, and email from token metadata on refresh', async () => {
    const { auth } = setup(
      {
        data: {
          session,
          user: {
            id: 'u1',
            email: 'siswa@sekolah.id',
            app_metadata: { role: 'administrator' },
            user_metadata: { role: 'staff', id: 'victim', email: 'x@y.z' },
          },
        },
        error: null,
      },
      null,
    );

    const { user } = await auth.refresh({ refreshToken: 'refresh' });
    expect(user).toMatchObject({
      id: 'u1',
      email: 'siswa@sekolah.id',
      role: null,
    });
  });

  it('returns role from the guard-resolved user on me()', () => {
    const { auth } = setup({ data: null, error: null }, null);
    expect(
      auth.me({ id: 'u1', email: 'staff@sekolah.id', role: 'staff' }).user.role,
    ).toBe('staff');
  });

  it('throws Unauthorized on invalid credentials', async () => {
    const { auth, getRole } = setup(
      {
        data: { session: null, user: null },
        error: new Error('Invalid login credentials'),
      },
      'siswa',
    );
    await expect(
      auth.signIn({ email: 'a@b.c', password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(getRole).not.toHaveBeenCalled();
  });

  it('throws Unauthorized with EMAIL_NOT_VERIFIED if email is not confirmed in Supabase', async () => {
    const { auth } = setup(
      {
        data: { session: null, user: null },
        error: new Error('Email not confirmed'),
      },
      'siswa',
    );
    await expect(
      auth.signIn({ email: 'unconfirmed@sekolah.id', password: 'pass' }),
    ).rejects.toMatchObject({
      response: {
        code: 'EMAIL_NOT_VERIFIED',
      },
    });
  });

  it('throws Unauthorized with EMAIL_NOT_VERIFIED if is_verified is false in database', async () => {
    const signInWithPassword = jest.fn().mockResolvedValue({
      data: {
        session,
        user: {
          id: 'u-unverified',
          email: 'unverified@sekolah.id',
          user_metadata: {},
        },
      },
      error: null,
    });
    const mockAdminClient = {
      from: jest.fn().mockReturnValue({
        select: jest.fn().mockReturnValue({
          eq: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue({
              data: [{ id: 'u-unverified', is_delete: false, is_active: true, is_verified: false }],
            }),
          }),
        }),
      }),
    };
    const service = {
      createAnonClient: () => ({ auth: { signInWithPassword } }),
      getAdminClient: () => mockAdminClient,
    } as unknown as SupabaseService;
    const userRoles = { getRole: jest.fn().mockResolvedValue('siswa') } as unknown as UserRoleService;
    const auth = new AuthService(service, userRoles);

    await expect(
      auth.signIn({ email: 'unverified@sekolah.id', password: 'pass' }),
    ).rejects.toMatchObject({
      response: {
        code: 'EMAIL_NOT_VERIFIED',
      },
    });
  });

  describe('forgotPassword', () => {
    it('throws NotFoundException if email is not found in database', async () => {
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({ data: [] }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: {} }),
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.forgotPassword({ email: 'notfound@sekolah.id' }),
      ).rejects.toThrow('Email tidak terdaftar dalam sistem.');
    });

    it('throws BadRequestException if account is deleted', async () => {
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u1', email: 'del@sekolah.id', is_delete: true, is_active: true, is_verified: true }],
              }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: {} }),
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.forgotPassword({ email: 'del@sekolah.id' }),
      ).rejects.toThrow('Akun telah dihapus.');
    });

    it('throws BadRequestException if account is inactive', async () => {
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u1', email: 'inact@sekolah.id', is_delete: false, is_active: false, is_verified: true }],
              }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: {} }),
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.forgotPassword({ email: 'inact@sekolah.id' }),
      ).rejects.toThrow('Akun Anda telah dinonaktifkan.');
    });

    it('throws BadRequestException if account is not verified', async () => {
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u1', email: 'unver@sekolah.id', is_delete: false, is_active: true, is_verified: false }],
              }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: {} }),
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.forgotPassword({ email: 'unver@sekolah.id' }),
      ).rejects.toThrow('Akun belum diverifikasi.');
    });

    it('sends resetPasswordForEmail if user is valid, active, and verified', async () => {
      const resetPasswordForEmail = jest.fn().mockResolvedValue({ error: null });
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u1', email: 'user@sekolah.id', is_delete: false, is_active: true, is_verified: true }],
              }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: { resetPasswordForEmail } }),
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      const res = await auth.forgotPassword({ email: 'user@sekolah.id' });
      expect(res.success).toBe(true);
      expect(resetPasswordForEmail).toHaveBeenCalledWith('user@sekolah.id');
    });
  });

  describe('resetPassword', () => {
    it('updates password in auth and user table', async () => {
      const updateUserById = jest.fn().mockResolvedValue({ error: null });
      const update = jest.fn().mockReturnValue({
        eq: jest.fn().mockResolvedValue({ error: null }),
      });
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            ilike: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u1', email: 'user@sekolah.id', is_delete: false, is_active: true, is_verified: true }],
              }),
            }),
          }),
          update,
        }),
        auth: {
          admin: { updateUserById },
        },
      };
      const service = {
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      const res = await auth.resetPassword({
        email: 'user@sekolah.id',
        newPassword: 'newPassword123',
      });

      expect(res.success).toBe(true);
      expect(updateUserById).toHaveBeenCalledWith('u1', { password: 'newPassword123' });
      expect(update).toHaveBeenCalledWith({ password: 'newPassword123' });
    });
  });
});
