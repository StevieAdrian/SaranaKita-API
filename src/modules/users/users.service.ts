import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { PaginatedResult, PaginationQueryDto } from '../../common/dto/pagination.dto';
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
  is_active?: boolean | null;
  is_delete?: boolean | null;
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

function labelClassOrPosition(
  role?: string | null,
  rawClassOrPos?: string | null,
): string | null {
  if (rawClassOrPos === undefined || rawClassOrPos === null) {
    return null;
  }
  const text = rawClassOrPos.trim();
  if (!text) return null;
  const lower = text.toLowerCase();
  const userRole = (role || '').toLowerCase();

  if (userRole === 'siswa') {
    if (lower.startsWith('kelas')) return text;
    return `Kelas ${text}`;
  }

  if (userRole === 'guru') {
    if (lower.includes('guru')) return text;
    return `Guru ${text}`;
  }

  if (userRole === 'staff') {
    if (lower.includes('staff')) return text;
    return `Staff ${text}`;
  }

  if (userRole === 'administrator') {
    if (lower.includes('admin')) return text;
    return `Administrator ${text}`;
  }

  return text;
}

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  private readonly table = 'user';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly userRoleService: UserRoleService,
  ) { }

  async findAll(
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<UserEntity>> {
    const { page, limit, search } = query;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    const adminRoleId = await this.userRoleService
      .getRoleId('administrator')
      .catch(() => null);

    const baseQuery = (withFilter: boolean) => {
      let b = this.supabaseService
        .getAdminClient()
        .from(this.table)
        .select(USER_SELECT, { count: 'exact' })
        .order('created_at', { ascending: false });

      if (adminRoleId) {
        b = b.neq('role_id', adminRoleId);
      }

      if (withFilter) {
        b = b.neq('is_delete', true);
      }

      if (search) {
        b = b.ilike('username', `%${escapeLike(search)}%`);
      }
      return b;
    };

    let { data, count, error } = await baseQuery(true).range(from, to);

    if (error && error.code === '42703') {
      const fallback = await baseQuery(false).range(from, to);
      data = fallback.data;
      count = fallback.count;
      error = fallback.error;
    }

    if (error) {
      this.logger.error(`Gagal memuat daftar pengguna: ${error.message}`);
      throw new BadRequestException(`Gagal memuat data pengguna: ${error.message}`);
    }

    const items = ((data as UserRow[] | null) ?? [])
      .map((row) => this.toEntity(row))
      .filter((u) => u.role !== 'administrator');

    const total = count ?? items.length;

    return {
      items,
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

    const countRole = async (roleId: string | null) => {
      if (!roleId) return 0;
      let res = await client
        .from(this.table)
        .select('id', { count: 'exact', head: true })
        .eq('role_id', roleId)
        .neq('is_delete', true);

      if (res.error && res.error.code === '42703') {
        res = await client
          .from(this.table)
          .select('id', { count: 'exact', head: true })
          .eq('role_id', roleId);
      }
      return res.count ?? 0;
    };

    const [totalSiswa, totalGuru, totalStaff] = await Promise.all([
      countRole(siswaRole),
      countRole(guruRole),
      countRole(staffRole),
    ]);

    return {
      totalSiswa,
      totalGuru,
      totalStaff,
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
      this.logger.error(`Gagal memuat pengguna dengan ID ${id}: ${error.message}`);
      throw new BadRequestException(`Gagal memuat pengguna: ${error.message}`);
    }
    if (!data) {
      throw new NotFoundException(`Pengguna dengan ID ${id} tidak ditemukan.`);
    }

    return this.toEntity(data as unknown as UserRow);
  }

  async create(dto: CreateUserDto): Promise<UserEntity> {
    if (dto.role === 'administrator') {
      throw new BadRequestException('Role administrator tidak dapat dibuat.');
    }
    const client = this.supabaseService.getAdminClient();
    const roleId = await this.userRoleService.getRoleId(dto.role);

    const password = dto.password || 'SaranaKita123';
    const email = dto.email.trim().toLowerCase();

    let fullName = dto.fullName?.trim();
    if (!fullName && (dto.firstName || dto.lastName)) {
      fullName = `${dto.firstName?.trim() ?? ''} ${dto.lastName?.trim() ?? ''}`.trim();
    }
    if (!fullName) {
      fullName = email.split('@')[0];
    }

    const username = dto.username?.trim() || email.split('@')[0];
    const cleanUsername = username.trim().toLowerCase();
    const { data: existingUser } = await client
      .from(this.table)
      .select('id')
      .ilike('username', cleanUsername)
      .limit(1);

    if (existingUser && existingUser.length > 0) {
      throw new BadRequestException('Username sudah digunakan.');
    }

    const { data: existingEmail } = await client
      .from(this.table)
      .select('id')
      .eq('email', email)
      .limit(1);

    if (existingEmail && existingEmail.length > 0) {
      throw new BadRequestException('Email sudah terdaftar.');
    }

    let genderLabel = dto.gender;
    const lowerGender = (dto.gender || '').trim().toLowerCase();
    if (lowerGender === 'female' || lowerGender === 'perempuan') {
      genderLabel = 'Perempuan';
    } else if (lowerGender === 'male' || lowerGender === 'laki-laki') {
      genderLabel = 'Laki-Laki';
    }

    const phone = dto.phone || dto.phoneNumber || undefined;

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status !== 'inactive'
          : true;

    const authRes = await client.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        full_name: fullName,
        first_name: dto.firstName?.trim() || undefined,
        last_name: dto.lastName?.trim() || undefined,
        phone,
        gender: genderLabel,
        is_delete: false,
        is_active: isActive,
        status: isActive ? 'active' : 'inactive',
      },
    });

    if (authRes.error || !authRes.data.user) {
      this.logger.error(
        `Gagal membuat akun autentikasi pengguna: ${authRes.error?.message ?? 'Unknown error'}`,
      );
      throw new BadRequestException(
        authRes.error?.message
          ? `Gagal membuat akun autentikasi: ${authRes.error.message}`
          : 'Gagal membuat akun autentikasi pengguna.',
      );
    }

    const userId = authRes.data.user.id;

    const userPayload: Record<string, unknown> = {
      id: userId,
      email,
      username: cleanUsername,
      password,
      role_id: roleId,
      is_verified: true,
      is_delete: false,
      is_active: isActive,
    };

    let { error: userError } = await client.from(this.table).upsert(userPayload);
    if (userError && userError.code === '42703') {
      delete userPayload.is_active;
      let retry = await client.from(this.table).upsert(userPayload);
      if (retry.error && retry.error.code === '42703') {
        delete userPayload.is_delete;
        retry = await client.from(this.table).upsert(userPayload);
      }
      userError = retry.error;
    }

    if (userError) {
      this.logger.error(`Gagal menyimpan data pengguna: ${userError.message}`);
      throw new BadRequestException(
        `Gagal menyimpan data pengguna: ${userError.message}`,
      );
    }

    const profilePayload: Record<string, unknown> = {
      user_id: userId,
      full_name: fullName,
      class: labelClassOrPosition(dto.role, dto.classOrPosition),
      dob: dto.dateOfBirth ?? null,
      profile_pict: dto.avatarUrl ?? null,
    };

    const { error: profileError } = await client
      .from('profile')
      .upsert(profilePayload);

    if (profileError) {
      this.logger.error(`Gagal menyimpan data profil: ${profileError.message}`);
      throw new BadRequestException(
        `Gagal menyimpan profil: ${profileError.message}`,
      );
    }

    let defaultSchoolId: string | null = null;
    const { data: defaultSchools } = await client
      .from('school')
      .select('id')
      .order('created_at', { ascending: true })
      .limit(1);

    if (defaultSchools && defaultSchools.length > 0) {
      defaultSchoolId = defaultSchools[0].id;
    } else {
      const { data: fallbackSchools } = await client
        .from('school')
        .select('id')
        .limit(1);
      defaultSchoolId = fallbackSchools?.[0]?.id ?? null;
    }

    if (defaultSchoolId) {
      const normalizedRole = (dto.role || '').toLowerCase();
      if (normalizedRole === 'siswa') {
        const { error: memErr } = await client
          .from('siswa')
          .upsert({ user_id: userId, school_id: defaultSchoolId });
        if (memErr) {
          this.logger.error(`Gagal menetapkan siswa ke sekolah: ${memErr.message}`);
        }
      } else if (normalizedRole === 'guru') {
        const { error: memErr } = await client
          .from('guru')
          .upsert({ user_id: userId, school_id: defaultSchoolId });
        if (memErr) {
          this.logger.error(`Gagal menetapkan guru ke sekolah: ${memErr.message}`);
        }
      } else if (normalizedRole === 'staff') {
        const { error: memErr } = await client
          .from('staff')
          .upsert({ user_id: userId, school_id: defaultSchoolId });
        if (memErr) {
          this.logger.error(`Gagal menetapkan staff ke sekolah: ${memErr.message}`);
        }
      }
    } else {
      this.logger.warn('Tidak ditemukan sekolah default untuk ditautkan ke pengguna baru.');
    }

    return this.findOne(userId);
  }

  async update(id: string, dto: UpdateUserDto): Promise<UserEntity> {
    const existing = await this.findOne(id);
    if (existing.role === 'administrator' || dto.role === 'administrator') {
      throw new BadRequestException('Role administrator tidak dapat diubah.');
    }
    const client = this.supabaseService.getAdminClient();

    if (dto.role) {
      const roleId = await this.userRoleService.getRoleId(dto.role);
      const { error } = await client
        .from(this.table)
        .update({ role_id: roleId })
        .eq('id', id);
      if (error) {
        this.logger.error(`Gagal memperbarui role pengguna ${id}: ${error.message}`);
        throw new BadRequestException(`Gagal memperbarui role pengguna: ${error.message}`);
      }

      if (dto.role !== existing.role) {
        if (existing.role === 'siswa') await client.from('siswa').delete().eq('user_id', id);
        else if (existing.role === 'guru') await client.from('guru').delete().eq('user_id', id);
        else if (existing.role === 'staff') await client.from('staff').delete().eq('user_id', id);

        const { data: defaultSchools } = await client
          .from('school')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1);
        const defaultSchoolId = defaultSchools?.[0]?.id;
        if (defaultSchoolId) {
          const targetRole = dto.role.toLowerCase();
          if (targetRole === 'siswa') {
            const { error: memErr } = await client.from('siswa').upsert({ user_id: id, school_id: defaultSchoolId });
            if (memErr) this.logger.error(`Gagal menetapkan siswa ke sekolah: ${memErr.message}`);
          } else if (targetRole === 'guru') {
            const { error: memErr } = await client.from('guru').upsert({ user_id: id, school_id: defaultSchoolId });
            if (memErr) this.logger.error(`Gagal menetapkan guru ke sekolah: ${memErr.message}`);
          } else if (targetRole === 'staff') {
            const { error: memErr } = await client.from('staff').upsert({ user_id: id, school_id: defaultSchoolId });
            if (memErr) this.logger.error(`Gagal menetapkan staff ke sekolah: ${memErr.message}`);
          }
        } else {
          this.logger.warn(`Tidak ditemukan sekolah default saat memperbarui role pengguna ${id}.`);
        }
      }
    }

    const currentRole = (dto.role || existing.role || '').toLowerCase();
    if (currentRole === 'siswa' || currentRole === 'guru' || currentRole === 'staff') {
      const checkMem = await client.from(currentRole).select('school_id').eq('user_id', id).maybeSingle();
      if (!checkMem.data?.school_id) {
        const { data: defaultSchools } = await client
          .from('school')
          .select('id')
          .order('created_at', { ascending: true })
          .limit(1);
        const defaultSchoolId = defaultSchools?.[0]?.id;
        if (defaultSchoolId) {
          const { error: memErr } = await client.from(currentRole).upsert({ user_id: id, school_id: defaultSchoolId });
          if (memErr) this.logger.error(`Gagal menetapkan ${currentRole} ke sekolah: ${memErr.message}`);
        } else {
          this.logger.warn(`Tidak ditemukan sekolah default untuk ${currentRole} dengan ID ${id}.`);
        }
      }
    }

    if (dto.username) {
      const cleanUsername = dto.username.trim().toLowerCase();
      const { data: existingUser } = await client
        .from(this.table)
        .select('id')
        .ilike('username', cleanUsername)
        .neq('id', id)
        .limit(1);

      if (existingUser && existingUser.length > 0) {
        throw new BadRequestException('Username sudah digunakan.');
      }

      const { error } = await client
        .from(this.table)
        .update({ username: cleanUsername })
        .eq('id', id);
      if (error) {
        this.logger.error(`Gagal memperbarui username pengguna ${id}: ${error.message}`);
        throw new BadRequestException(`Gagal memperbarui username pengguna: ${error.message}`);
      }
    }

    if (dto.password) {
      await client.auth.admin.updateUserById(id, {
        password: dto.password,
      });
    }

    let fullName = dto.fullName?.trim();
    if (!fullName && (dto.firstName || dto.lastName)) {
      fullName = `${dto.firstName?.trim() ?? ''} ${dto.lastName?.trim() ?? ''}`.trim();
    }

    if (
      fullName !== undefined ||
      dto.classOrPosition !== undefined ||
      dto.dateOfBirth !== undefined ||
      dto.avatarUrl !== undefined
    ) {
      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      };
      if (fullName !== undefined) {
        updates.full_name = fullName;
      }
      if (dto.classOrPosition !== undefined) {
        const effectiveRole = dto.role || existing.role;
        updates.class = labelClassOrPosition(
          effectiveRole,
          dto.classOrPosition,
        );
      }
      if (dto.dateOfBirth !== undefined) {
        updates.dob = dto.dateOfBirth;
      }
      if (dto.avatarUrl !== undefined) {
        updates.profile_pict = dto.avatarUrl;
      }

      const { error } = await client
        .from('profile')
        .upsert({ user_id: id, ...updates }, { onConflict: 'user_id' });
      if (error) {
        this.logger.error(`Gagal memperbarui data profil pengguna ${id}: ${error.message}`);
        throw new BadRequestException(`Gagal memperbarui data profil pengguna: ${error.message}`);
      }
    }

    const metadataUpdates: Record<string, unknown> = {};
    if (fullName !== undefined) metadataUpdates.full_name = fullName;
    if (dto.firstName !== undefined) metadataUpdates.first_name = dto.firstName;
    if (dto.lastName !== undefined) metadataUpdates.last_name = dto.lastName;
    const phone = dto.phone || dto.phoneNumber;
    if (phone !== undefined) metadataUpdates.phone = phone;
    if (dto.gender !== undefined) {
      let genderLabel = dto.gender;
      const lowerGender = (dto.gender || '').trim().toLowerCase();
      if (lowerGender === 'female' || lowerGender === 'perempuan') {
        genderLabel = 'Perempuan';
      } else if (lowerGender === 'male' || lowerGender === 'laki-laki') {
        genderLabel = 'Laki-Laki';
      }
      metadataUpdates.gender = genderLabel;
    }

    const isActive =
      dto.isActive !== undefined
        ? dto.isActive
        : dto.status !== undefined
          ? dto.status !== 'inactive'
          : undefined;

    if (isActive !== undefined) {
      metadataUpdates.is_active = isActive;
      metadataUpdates.status = isActive ? 'active' : 'inactive';
      try {
        await client
          .from(this.table)
          .update({ is_active: isActive })
          .eq('id', id);
      } catch { }
    }

    if (Object.keys(metadataUpdates).length > 0) {
      const existingAuthUser = await client.auth.admin
        .getUserById(id)
        .then((r) => r.data?.user)
        .catch(() => null);

      const mergedMetadata = {
        ...(existingAuthUser?.user_metadata ?? {}),
        ...metadataUpdates,
      };

      await client.auth.admin
        .updateUserById(id, { user_metadata: mergedMetadata })
        .catch(() => { });
    }

    return this.findOne(id);
  }

  async remove(id: string): Promise<void> {
    const user = await this.findOne(id);
    if (user.role === 'administrator') {
      throw new BadRequestException('Akun administrator tidak dapat dihapus.');
    }
    const client = this.supabaseService.getAdminClient();

    const { error } = await client
      .from(this.table)
      .update({ is_delete: true, is_active: false })
      .eq('id', id);

    if (error) {
      this.logger.error(`Gagal menghapus pengguna ${id}: ${error.message}`);
      throw new BadRequestException(`Gagal menghapus pengguna: ${error.message}`);
    }

    await client.auth.admin
      .updateUserById(id, {
        ban_duration: '876000h',
        user_metadata: {
          is_delete: true,
          is_active: false,
          status: 'inactive',
        },
      })
      .catch(() => { });
  }

  private toEntity(row: UserRow): UserEntity {
    const prof = first(row.profile);
    const isActive =
      row.is_active !== undefined && row.is_active !== null
        ? Boolean(row.is_active)
        : row.is_delete
          ? false
          : true;

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
      status: isActive ? 'active' : 'inactive',
      isActive,
    };
  }
}
