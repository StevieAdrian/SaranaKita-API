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

  it('returns role from the guard-resolved user on me()', async () => {
    const { auth } = setup({ data: null, error: null }, null);
    const res = await auth.me({ id: 'u1', email: 'staff@sekolah.id', role: 'staff' });
    expect(res.user.role).toBe('staff');
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
    it('updates password in Supabase Auth without writing to public.user', async () => {
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
      expect(updateUserById).toHaveBeenCalledWith('u1', {
        password: 'newPassword123',
      });
      expect(update).not.toHaveBeenCalled();
    });
  });

  describe('signIn and refresh edge cases', () => {
    it('uses Supabase Auth as single source of truth without falling back to public.user', async () => {
      const signInWithPassword = jest.fn().mockResolvedValue({
        data: { session: null, user: null },
        error: new Error('Invalid login credentials'),
      });
      const updateUserById = jest.fn();
      const fromSpy = jest.fn();
      const mockAdminClient = {
        from: fromSpy,
        auth: {
          admin: { updateUserById },
        },
      };

      const service = {
        createAnonClient: () => ({ auth: { signInWithPassword } }),
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const userRoles = { getRole: jest.fn().mockResolvedValue('siswa') } as unknown as UserRoleService;
      const auth = new AuthService(service, userRoles);

      await expect(
        auth.signIn({
          email: 'user@sekolah.id',
          password: 'wrong-password',
        }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(updateUserById).not.toHaveBeenCalled();
      expect(fromSpy).not.toHaveBeenCalled();
    });

    it('throws UnauthorizedException when signing in to a deleted account in database', async () => {
      const signInWithPassword = jest.fn().mockResolvedValue({
        data: {
          session,
          user: { id: 'u-del', email: 'del@sekolah.id', user_metadata: {} },
        },
        error: null,
      });
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u-del', is_delete: true, is_active: true, is_verified: true }],
              }),
            }),
          }),
        }),
      };
      const service = {
        createAnonClient: () => ({ auth: { signInWithPassword } }),
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.signIn({ email: 'del@sekolah.id', password: 'secret' }),
      ).rejects.toThrow('Akun telah dihapus.');
    });

    it('throws UnauthorizedException when signing in to an inactive account in database', async () => {
      const signInWithPassword = jest.fn().mockResolvedValue({
        data: { session, user: { id: 'u-inact', email: 'inact@sekolah.id', user_metadata: {} } },
        error: null,
      });
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u-inact', is_delete: false, is_active: false, is_verified: true }],
              }),
            }),
          }),
        }),
      };
      const service = {
        createAnonClient: () => ({ auth: { signInWithPassword } }),
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.signIn({ email: 'inact@sekolah.id', password: 'secret' }),
      ).rejects.toThrow('Akun Anda telah dinonaktifkan.');
    });

    it('throws UnauthorizedException on token refresh if account is inactive in database', async () => {
      const refreshSession = jest.fn().mockResolvedValue({
        data: { session, user: { id: 'u-inact', email: 'inact@sekolah.id', user_metadata: {} } },
        error: null,
      });
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ id: 'u-inact', is_delete: false, is_active: false }],
              }),
            }),
          }),
        }),
      };
      const service = {
        createAnonClient: () => ({ auth: { refreshSession } }),
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      await expect(
        auth.refresh({ refreshToken: 'some-refresh-token' }),
      ).rejects.toThrow('Akun Anda telah dinonaktifkan.');
    });

    it('prioritizes public.profile.full_name over user_metadata in me()', async () => {
      const mockAdminClient = {
        from: jest.fn().mockReturnValue({
          select: jest.fn().mockReturnValue({
            eq: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue({
                data: [{ full_name: 'Profile Name Bryan' }],
              }),
            }),
          }),
        }),
      };
      const service = {
        getAdminClient: () => mockAdminClient,
      } as unknown as SupabaseService;
      const auth = new AuthService(service, {} as UserRoleService);

      const res = await auth.me({
        id: 'u-bryan',
        email: 'bryan@sekolah.id',
        role: 'siswa',
        full_name: 'Overridden Google Name',
      } as any);

      expect(res.user.displayName).toBe('Profile Name Bryan');
    });

    it('completeGoogleProfile saves siswa account and returns fresh session tokens', async () => {
      const updateUserById = jest.fn().mockResolvedValue({ error: null });
      const userUpsert = jest.fn().mockResolvedValue({ error: null });
      const signInWithPassword = jest.fn().mockResolvedValue({
        data: {
          session: {
            access_token: 'fresh-google-access',
            refresh_token: 'fresh-google-refresh',
          },
        },
        error: null,
      });
      const mockAdminClient = {
        from: jest.fn().mockImplementation((table: string) => {
          if (table === 'user') {
            return {
              select: jest.fn().mockReturnValue({
                ilike: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({ data: [] }),
                }),
              }),
              upsert: userUpsert,
            };
          }
          if (table === 'profile' || table === 'siswa') {
            return {
              upsert: jest.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'school') {
            return {
              select: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [{ id: 'sch-1' }] }),
              }),
            };
          }
          return {};
        }),
        auth: {
          admin: { updateUserById },
        },
      };
      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: { signInWithPassword } }),
      } as unknown as SupabaseService;
      const userRoles = {
        getRoleId: jest.fn().mockResolvedValue('role-siswa-id'),
      } as unknown as UserRoleService;
      const auth = new AuthService(service, userRoles);

      const res = await auth.completeGoogleProfile(
        { id: 'u-google-1', email: 'bryan@gmail.com', role: null },
        {
          username: 'bryan_g',
          password: 'password123',
          firstName: 'Bryan',
          lastName: 'Bebek',
          phone: '081234567890',
          dateOfBirth: '2006-05-10',
          class: '10-A',
          gender: 'Laki-Laki',
          avatarUrl: 'https://example.com/avatar.jpg',
        },
      );

      expect(updateUserById).toHaveBeenCalledWith(
        'u-google-1',
        expect.objectContaining({ password: 'password123' }),
      );
      expect(userUpsert).toHaveBeenCalledWith({
        id: 'u-google-1',
        email: 'bryan@gmail.com',
        username: 'bryan_g',
        role_id: 'role-siswa-id',
        is_verified: true,
        is_active: true,
        is_delete: false,
      });
      expect(res.user).toEqual({
        id: 'u-google-1',
        email: 'bryan@gmail.com',
        username: 'bryan_g',
        displayName: 'Bryan Bebek',
        role: 'siswa',
      });
      expect(res.tokens).toEqual({
        accessToken: 'fresh-google-access',
        refreshToken: 'fresh-google-refresh',
      });
    });

    it('register creates user in Supabase Auth with password and upserts public.user without password', async () => {
      const createUser = jest.fn().mockResolvedValue({
        data: { user: { id: 'u-reg-1' } },
        error: null,
      });
      const userUpsert = jest.fn().mockResolvedValue({ error: null });
      const signInWithPassword = jest.fn().mockResolvedValue({
        data: {
          session,
          user: {
            id: 'u-reg-1',
            email: 'newsiswa@sekolah.id',
            user_metadata: { full_name: 'Siswa Baru' },
          },
        },
        error: null,
      });
      const resend = jest.fn().mockResolvedValue({ error: null });

      const mockAdminClient = {
        from: jest.fn().mockImplementation((table: string) => {
          if (table === 'user') {
            return {
              select: jest.fn().mockReturnValue({
                or: jest.fn().mockResolvedValue({ data: [] }),
                eq: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({
                    data: [
                      {
                        id: 'u-reg-1',
                        is_delete: false,
                        is_active: true,
                        is_verified: true,
                      },
                    ],
                  }),
                }),
              }),
              upsert: userUpsert,
            };
          }
          if (table === 'profile' || table === 'siswa') {
            return {
              select: jest.fn().mockReturnValue({
                eq: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue({
                    data: [{ full_name: 'Siswa Baru' }],
                  }),
                }),
              }),
              upsert: jest.fn().mockResolvedValue({ error: null }),
            };
          }
          if (table === 'school') {
            return {
              select: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue({ data: [{ id: 'sch-1' }] }),
              }),
            };
          }
          return {};
        }),
        auth: {
          admin: { createUser },
        },
      };

      const service = {
        getAdminClient: () => mockAdminClient,
        createAnonClient: () => ({ auth: { signInWithPassword, resend } }),
      } as unknown as SupabaseService;
      const userRoles = {
        getRoleId: jest.fn().mockResolvedValue('role-siswa-id'),
        getRole: jest.fn().mockResolvedValue('siswa'),
      } as unknown as UserRoleService;
      const auth = new AuthService(service, userRoles);

      await auth.register({
        username: 'siswabaru',
        email: 'newsiswa@sekolah.id',
        password: 'PasswordBaru123',
        firstName: 'Siswa',
        lastName: 'Baru',
        phone: '08123456789',
        dateOfBirth: '2008-01-01',
        class: '10-A',
        gender: 'Laki-Laki',
      });

      expect(createUser).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'newsiswa@sekolah.id',
          password: 'PasswordBaru123',
        }),
      );
      expect(userUpsert).toHaveBeenCalledWith({
        id: 'u-reg-1',
        email: 'newsiswa@sekolah.id',
        username: 'siswabaru',
        role_id: 'role-siswa-id',
        is_verified: false,
      });
    });
  });
});
