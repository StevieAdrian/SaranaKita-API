import { UnauthorizedException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import type { SupabaseService } from '../../supabase/supabase.service';
import { SupabaseAuthGuard } from './supabase-auth.guard';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));

type MockUser = {
  id: string;
  email?: string;
  app_metadata?: Record<string, unknown>;
  user_metadata?: Record<string, unknown>;
};

function setup(user: MockUser | null, authorization = 'Bearer token-123') {
  const getUser = jest.fn().mockResolvedValue({
    data: { user },
    error: user ? null : new Error('invalid'),
  });
  const supabase = {
    getAdminClient: () => ({ auth: { getUser } }),
  } as unknown as SupabaseService;
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(false),
  } as unknown as Reflector;

  const request: Record<string, unknown> = { headers: { authorization } };
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;

  return { guard: new SupabaseAuthGuard(supabase, reflector), context, request };
}

describe('SupabaseAuthGuard', () => {
  it('takes role from app_metadata', async () => {
    const { guard, context, request } = setup({
      id: 'u1',
      email: 'a@b.c',
      app_metadata: { role: 'staff' },
      user_metadata: { full_name: 'Alicia' },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({
      id: 'u1',
      email: 'a@b.c',
      role: 'staff',
      full_name: 'Alicia',
    });
  });

  it('ignores role, id, and email injected via user_metadata', async () => {
    const { guard, context, request } = setup({
      id: 'u1',
      email: 'a@b.c',
      app_metadata: { role: 'siswa' },
      user_metadata: { role: 'staff', id: 'victim', email: 'x@y.z' },
    });

    await guard.canActivate(context);
    expect(request.user).toMatchObject({ id: 'u1', email: 'a@b.c', role: 'siswa' });
  });

  it('falls back to "user" when app_metadata has no role', async () => {
    const { guard, context, request } = setup({
      id: 'u1',
      user_metadata: { role: 'staff' },
    });

    await guard.canActivate(context);
    expect(request.user).toMatchObject({ role: 'user' });
  });

  it('rejects requests without a bearer token', async () => {
    const { guard, context } = setup({ id: 'u1' }, '');
    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});
