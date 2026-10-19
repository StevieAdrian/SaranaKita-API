import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { toUserRole } from '../../common/utils/resolve-role';
import { UserRoleService } from '../roles/user-role.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

const USER_SELECT =
  'id, username, email, is_verified, created_at, roles(role_name), profile(full_name, class, profile_pict)';

type Related<T> = T | T[] | null | undefined;

type UserRow = {
  id: string;
  username: string | null;
  email: string;
  is_verified: boolean | null;
  created_at: string;
  roles: Related<{ role_name: string | null }>;
  profile: Related<{
    full_name: string | null;
    class: string | null;
    profile_pict: string | null;
  }>;
};

function first<T>(value: Related<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

@Injectable()
export class UsersService {
  private readonly table = 'user';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly userRoleService: UserRoleService,
  ) {}

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserEntity>> {
    const { page, limit, search } = query;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let builder = this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select(USER_SELECT, { count: 'exact' })
      .order('created_at', { ascending: false });

    if (search) {
      builder = builder.ilike('username', `%${escapeLike(search)}%`);
    }

    const { data, count, error } = await builder.range(from, to);

    if (error) {
      throw error;
    }

    const total = count ?? 0;

    return {
      items: ((data as UserRow[] | null) ?? []).map((row) =>
        this.toEntity(row),
      ),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async getSummary(): Promise<{
    totalSiswa: number;
    totalGuru: number;
    totalStaff: number;
  }> {
    const client = this.supabaseService.getAdminClient();
    const [siswaRole, guruRole, staffRole] = await Promise.all([
      this.userRoleService.getRoleId('siswa').catch(() => null),
      this.userRoleService.getRoleId('guru').catch(() => null),
      this.userRoleService.getRoleId('staff').catch(() => null),
    ]);

    const [siswaRes, guruRes, staffRes] = await Promise.all([
      siswaRole
        ? client
            .from(this.table)
            .select('id', { count: 'exact', head: true })
            .eq('role_id', siswaRole)
        : Promise.resolve({ count: 0, error: null }),
      guruRole
        ? client
            .from(this.table)
            .select('id', { count: 'exact', head: true })
            .eq('role_id', guruRole)
        : Promise.resolve({ count: 0, error: null }),
      staffRole
        ? client
            .from(this.table)
            .select('id', { count: 'exact', head: true })
            .eq('role_id', staffRole)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    return {
      totalSiswa: siswaRes.count ?? 0,
      totalGuru: guruRes.count ?? 0,
      totalStaff: staffRes.count ?? 0,
    };
  }

  async findOne(id: string): Promise<UserEntity> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select(USER_SELECT)
      .eq('id', id)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException(`User ${id} not found`);
    }

    return this.toEntity(data as unknown as UserRow);
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    const client = this.supabaseService.getAdminClient();
    const roleId = await this.userRoleService.getRoleId(dto.role);

    const password = dto.password || 'SaranaKita123!';
    const email = dto.email.trim().toLowerCase();

    const authRes = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: dto.fullName },
    });

    if (authRes.error || !authRes.data.user) {
      throw new BadRequestException(
        authRes.error?.message ?? 'Gagal membuat user auth.',
      );
    }

    const userId = authRes.data.user.id;

    const { error: userError } = await client.from(this.table).upsert({
      id: userId,
      email,
      username: email.split('@')[0],
      password,
      role_id: roleId,
      is_verified: true,
    });

    if (userError) {
      throw new BadRequestException(
        `Gagal menyimpan user: ${userError.message}`,
      );
    }

    await client.from('profile').upsert({
      user_id: userId,
      full_name: dto.fullName,
      class: dto.classOrPosition ?? null,
    });

    const { data: defaultSchool } = await client
      .from('school')
      .select('id')
      .limit(1)
      .maybeSingle();

    if (defaultSchool?.id) {
      if (dto.role === 'siswa') {
        await client
          .from('siswa')
          .upsert({ user_id: userId, school_id: defaultSchool.id });
      } else if (dto.role === 'guru') {
        await client
          .from('guru')
          .upsert({ user_id: userId, school_id: defaultSchool.id });
      } else if (dto.role === 'staff') {
        await client
          .from('staff')
          .upsert({ user_id: userId, school_id: defaultSchool.id });
      }
    }

    return this.findOne(userId);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    await this.findOne(id);
    const client = this.supabaseService.getAdminClient();

    if (dto.role) {
      const roleId = await this.userRoleService.getRoleId(dto.role);
      const { error } = await client
        .from(this.table)
        .update({ role_id: roleId })
        .eq('id', id);
      if (error) {
        throw error;
      }
    }

    if (dto.fullName !== undefined || dto.classOrPosition !== undefined) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (dto.fullName !== undefined) {
        updates.full_name = dto.fullName;
      }
      if (dto.classOrPosition !== undefined) {
        updates.class = dto.classOrPosition;
      }

      const { error } = await client
        .from('profile')
        .upsert({ user_id: id, ...updates }, { onConflict: 'user_id' });
      if (error) {
        throw error;
      }
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    const client = this.supabaseService.getAdminClient();

    await client.from('profile').delete().eq('user_id', id);
    await client.from('siswa').delete().eq('user_id', id);
    await client.from('guru').delete().eq('user_id', id);
    await client.from('staff').delete().eq('user_id', id);

    const { error } = await client.from(this.table).delete().eq('id', id);
    if (error) {
      throw new BadRequestException(`Gagal menghapus user: ${error.message}`);
    }

    await client.auth.admin.deleteUser(id).catch(() => {});
  }

  private toEntity(row: UserRow): UserEntity {
    const prof = first(row.profile);
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: prof?.full_name ?? null,
      role: toUserRole(first(row.roles)?.role_name),
      isVerified: row.is_verified ?? false,
      createdAt: row.created_at,
      classOrPosition: prof?.class ?? null,
      avatarUrl: prof?.profile_pict ?? null,
      status: 'active',
    };
  }
}
