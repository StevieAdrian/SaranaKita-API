import { ForbiddenException, type ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function setup(required: string[] | undefined, role: string | null) {
  const reflector = {
    getAllAndOverride: jest.fn().mockReturnValue(required),
  } as unknown as Reflector;
  const context = {
    getHandler: () => undefined,
    getClass: () => undefined,
    switchToHttp: () => ({ getRequest: () => ({ user: { id: 'u1', role } }) }),
  } as unknown as ExecutionContext;
  return { guard: new RolesGuard(reflector), context };
}

describe('RolesGuard', () => {
  it('allows any authenticated user when no roles are required', () => {
    const { guard, context } = setup(undefined, null);
    expect(guard.canActivate(context)).toBe(true);
  });

  it('allows a user whose role is required', () => {
    const { guard, context } = setup(['administrator'], 'administrator');
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each([null, 'staff'])('denies role %p', (role) => {
    const { guard, context } = setup(['administrator'], role);
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
