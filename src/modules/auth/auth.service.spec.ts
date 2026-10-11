import { UnauthorizedException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserRoleService } from '../roles/user-role.service';
import { AuthService } from './auth.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));
jest.mock('../roles/user-role.service', () => ({
  UserRoleService: class {},
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
});
