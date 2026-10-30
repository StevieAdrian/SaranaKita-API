import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserRoleService } from '../../modules/roles/user-role.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class { },
}));
jest.mock('../../modules/roles/user-role.service', () => ({
  UserRoleService: class { },
}));

type MockUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function setup(
  user: MockUser | null,
  dbRole: string | null = 'siswa',
  authorization = 'Bearer token-123',
  dbUser?: { id: string; is_active?: boolean; is_delete?: boolean; is_verified?: boolean } | null,
) {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : new Error('invalid'),
  });
  const update = jest.fn().mockReturnValue({
    eq: jest.fn().mockResolvedValue({ error: null }),
  });
  const from = jest.fn().mockReturnValue({
    select: jest.fn().mockReturnValue({
      eq: jest.fn().mockReturnValue({
        limit: jest
          .fn()
          .mockResolvedValue({ data: dbUser ? [dbUser] : [], error: null }),
        maybeSingle: jest.fn().mockResolvedValue({
          data: dbUser !== undefined ? dbUser : null,
          error: null,
        }),
      }),
    }),
    update,
  });
  const supabase = {
    getAdminClient: () => ({ auth: { getUser }, from }),
  } as unknown as SupabaseService;
  const getRole = jest.fn().mockResolvedValue(dbRole);
  const userRoles = { getRole } as unknown as UserRoleService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;

  const request: Record<string, unknown> = { headers: { authorization } };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return {
    guard: new SupabaseAuthGuard(supabase, userRoles, reflector),
    context,
    request,
    getRole,
    from,
    update,
  };
}

describe('SupabaseAuthGuard', () => {
  it('takes role from the database for the token user', async () => {
    const { guard, context, request, getRole } = setup(
      { id: 'u1', email: 'a@b.c', user_metadata: { full_name: 'Alicia' } },
      'staff',
    );

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(getRole).toHaveBeenCalledWith('u1');
    expect(request.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      role: 'staff',
      full_name: 'Alicia',
    });
  });

  it('ignores role, id, and email from token metadata', async () => {
    const { guard, context, request, getRole } = setup(
      {
        id: 'u1',
        email: 'a@b.c',
        app_metadata: { role: 'administrator' },
        user_metadata: { role: 'staff', id: 'victim', email: 'x@y.z' },
      },
      'siswa',
    );

    await guard.canActivate(context);
    expect(getRole).toHaveBeenCalledWith('u1');
    expect(request.user).toMatchObject({
      id: 'u1',
      email: 'a@b.c',
      role: 'siswa',
    });
  });

  it('keeps role null when the user has no role in the database', async () => {
    const { guard, context, request } = setup({ id: 'u1' }, null);
    await guard.canActivate(context);
    expect(request.user).toMatchObject({ role: null });
  });

  it('rejects requests without a bearer token', async () => {
    const { guard, context, getRole } = setup({ id: 'u1' }, 'siswa', '');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(getRole).not.toHaveBeenCalled();
  });

  it('rejects requests if user in metadata has is_delete = true', async () => {
    const { guard, context } = setup(
      { id: 'u1', user_metadata: { is_delete: true } },
      'siswa',
    );
    await expect(guard.canActivate(context)).rejects.toThrow('Akun telah dihapus.');
  });

  it('rejects requests if user in metadata has is_active = false', async () => {
    const { guard, context } = setup(
      { id: 'u1', user_metadata: { is_active: false } },
      'siswa',
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.',
    );
  });

  it('rejects requests if user in database is marked is_delete = true', async () => {
    const { guard, context } = setup(
      { id: 'u1', email: 'del@sekolah.id', user_metadata: {} },
      'siswa',
      'Bearer token-123',
      { id: 'u1', is_delete: true, is_active: true },
    );
    await expect(guard.canActivate(context)).rejects.toThrow('Akun telah dihapus.');
  });

  it('rejects requests if user in database is marked is_active = false', async () => {
    const { guard, context } = setup(
      { id: 'u1', email: 'inact@sekolah.id', user_metadata: {} },
      'siswa',
      'Bearer token-123',
      { id: 'u1', is_delete: false, is_active: false },
    );
    await expect(guard.canActivate(context)).rejects.toThrow(
      'Akun Anda telah dinonaktifkan. Silakan hubungi Staff atau Administrator.',
    );
  });

  it('auto-syncs is_verified = true when email_confirmed_at is present and user is unverified', async () => {
    const { guard, context, update } = setup(
      {
        id: 'u1',
        email: 'v@sekolah.id',
        user_metadata: {},
        email_confirmed_at: '2026-10-28T10:00:00Z',
      } as any,
      'siswa',
      'Bearer token-123',
      { id: 'u1', is_delete: false, is_active: true, is_verified: false },
    );
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(update).toHaveBeenCalledWith({ is_verified: true });
  });
});
