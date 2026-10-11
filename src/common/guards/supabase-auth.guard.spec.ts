import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserRoleService } from '../../modules/roles/user-role.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));
jest.mock('../../modules/roles/user-role.service', () => ({
  UserRoleService: class {},
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
) {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : new Error('invalid'),
  });
  const supabase = {
    getAdminClient: () => ({ auth: { getUser } }),
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
});
