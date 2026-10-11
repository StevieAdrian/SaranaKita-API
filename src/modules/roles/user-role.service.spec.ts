import { BadRequestException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import { toUserRole } from '../../common/utils/resolve-role';
import { UserRoleService } from './user-role.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));

function setup(result: { data: unknown; error: unknown }) {
  const c: Record<string, jest.Mock> = {};
  c.select = jest.fn(() => c);
  c.eq = jest.fn(() => c);
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  const from = jest.fn(() => c);
  const service = {
    getAdminClient: () => ({ from }),
  } as unknown as SupabaseService;
  return { roles: new UserRoleService(service), from, c };
}

describe('toUserRole', () => {
  it.each([
    ['siswa', 'siswa'],
    [' Guru ', 'guru'],
    ['STAFF', 'staff'],
    ['administrator', 'administrator'],
  ])('accepts %p', (input, expected) => {
    expect(toUserRole(input)).toBe(expected);
  });

  it.each([null, undefined, '', 'user', 'admin', 42])('rejects %p', (input) => {
    expect(toUserRole(input)).toBeNull();
  });
});

describe('UserRoleService.getRole', () => {
  it('reads role via public.user -> roles', async () => {
    const { roles, from, c } = setup({
      data: { roles: { role_name: 'siswa' } },
      error: null,
    });

    await expect(roles.getRole('u1')).resolves.toBe('siswa');
    expect(from).toHaveBeenCalledWith('user');
    expect(c.select).toHaveBeenCalledWith('roles(role_name)');
    expect(c.eq).toHaveBeenCalledWith('id', 'u1');
  });

  it('handles the relation returned as an array', async () => {
    const { roles } = setup({
      data: { roles: [{ role_name: 'guru' }] },
      error: null,
    });
    await expect(roles.getRole('u1')).resolves.toBe('guru');
  });

  it.each([
    ['no user row', null],
    ['no role', { roles: null }],
    ['unknown role', { roles: { role_name: 'superuser' } }],
  ])('returns null for %s', async (_label, data) => {
    const { roles } = setup({ data, error: null });
    await expect(roles.getRole('u1')).resolves.toBeNull();
  });

  it('throws on database errors', async () => {
    const error = new Error('db down');
    const { roles } = setup({ data: null, error });
    await expect(roles.getRole('u1')).rejects.toBe(error);
  });
});

describe('UserRoleService.getRoleId', () => {
  it('returns the id of an existing role', async () => {
    const { roles, from } = setup({ data: { id: 'r1' }, error: null });
    await expect(roles.getRoleId('staff')).resolves.toBe('r1');
    expect(from).toHaveBeenCalledWith('roles');
  });

  it('throws BadRequest when the role row is missing', async () => {
    const { roles } = setup({ data: null, error: null });
    await expect(roles.getRoleId('guru')).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });
});
