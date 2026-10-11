import {
  Injectable,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../common/dto/pagination.dto';
import { toUserRole } from '../../common/utils/resolve-role';
import { UserRoleService } from '../roles/user-role.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';

const USER_SELECT =
  'id, username, email, is_verified, created_at, roles(role_name), profile(full_name)';

type Related<T> = T | T[] | null | undefined;

type UserRow = {
  id: string;
  username: string | null;
  email: string;
  is_verified: boolean | null;
  created_at: string;
  roles: Related<{ role_name: string | null }>;
  profile: Related<{ full_name: string | null }>;
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

    return this.toEntity(data);
  }

  create(): Promise<UserEntity> {
    return Promise.reject(
      new NotImplementedException('Pembuatan user belum didukung.'),
    );
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

    if (dto.fullName !== undefined) {
      const { error } = await client
        .from('profile')
        .update({
          full_name: dto.fullName,
          updated_at: new Date().toISOString(),
        })
        .eq('user_id', id);
      if (error) {
        throw error;
      }
    }

    return this.findOne(id);
  }

  remove(): Promise<void> {
    return Promise.reject(
      new NotImplementedException('Penghapusan user belum didukung.'),
    );
  }

  private toEntity(row: UserRow): UserEntity {
    return {
      id: row.id,
      username: row.username,
      email: row.email,
      fullName: first(row.profile)?.full_name ?? null,
      role: toUserRole(first(row.roles)?.role_name),
      isVerified: row.is_verified ?? false,
      createdAt: row.created_at,
    };
  }
}
