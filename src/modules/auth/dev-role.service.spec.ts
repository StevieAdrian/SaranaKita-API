import {
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { UserRoleService } from '../roles/user-role.service';
import { DevRoleService } from './dev-role.service';

jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));
jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));
jest.mock('../roles/user-role.service', () => ({ UserRoleService: class {} }));

const USER = { id: 'u1', email: 'Siswa@Sekolah.id' };
const PASSWORD = 'bypass1234';

function setup(
  overrides: { nodeEnv?: string; password?: string | undefined } = {},
  updateError: unknown = null,
) {
  const config = {
    get: (key: string) =>
      key === 'nodeEnv'
        ? (overrides.nodeEnv ?? 'development')
        : 'password' in overrides
          ? overrides.password
          : PASSWORD,
  } as unknown as ConfigService;

  const update = jest.fn(() => ({
    eq: jest.fn().mockResolvedValue({ error: updateError }),
  }));
  const supabase = {
    getAdminClient: () => ({ from: () => ({ update }) }),
  } as unknown as SupabaseService;

  const getRoleId = jest.fn().mockResolvedValue('role-guru');
  const roles = { getRoleId } as unknown as UserRoleService;

  return {
    service: new DevRoleService(config, supabase, roles),
    update,
    getRoleId,
  };
}

const body = {
  email: 'siswa@sekolah.id',
  password: PASSWORD,
  role: 'guru' as const,
};

describe('DevRoleService.switchRole', () => {
  it('updates the role for the logged-in user', async () => {
    const { service, update, getRoleId } = setup();
    await expect(service.switchRole(USER, body)).resolves.toEqual({
      role: 'guru',
    });
    expect(getRoleId).toHaveBeenCalledWith('guru');
    expect(update).toHaveBeenCalledWith({ role_id: 'role-guru' });
  });

  it('is hidden (404) in production', async () => {
    const { service } = setup({ nodeEnv: 'production' });
    await expect(service.switchRole(USER, body)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('is hidden (404) when no bypass password is configured', async () => {
    const { service } = setup({ password: undefined });
    await expect(service.switchRole(USER, body)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('rejects a wrong password', async () => {
    const { service } = setup();
    await expect(
      service.switchRole(USER, { ...body, password: 'wrong' }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects when the email does not match the token user', async () => {
    const { service } = setup();
    await expect(
      service.switchRole(USER, { ...body, email: 'lain@sekolah.id' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('propagates database errors', async () => {
    const dbError = new Error('db down');
    const { service } = setup({}, dbError);
    await expect(service.switchRole(USER, body)).rejects.toBe(dbError);
  });
});
