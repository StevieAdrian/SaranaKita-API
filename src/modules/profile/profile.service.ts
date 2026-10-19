import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { toUserRole, type UserRole } from '../../common/utils/resolve-role';
import { SchoolMembershipService } from '../schools/school-membership.service';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

type Related<T> = T | T[] | null | undefined;

type UserProfileRow = {
  id: string;
  email: string;
  username: string | null;
  roles: Related<{ role_name: string | null }>;
  profile: Related<{
    full_name: string | null;
    nickname: string | null;
    class: string | null;
    dob: string | null;
    profile_pict: string | null;
  }>;
};

function first<T>(value: Related<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

export type FullUserProfile = {
  id: string;
  email: string;
  fullName: string;
  role: UserRole | null;
  phone: string;
  birthDate: string;
  gender: string;
  avatarUrl: string | null;
  classOrPosition: string;
  schoolInfo: {
    name: string;
    address: string;
    npsn: string;
    principal: string;
    phone: string;
    accreditation: string;
  };
  stats: {
    reportsCreated: number;
    votesCount: number;
    recommendationsCount: number;
    pendingConfirmation: number;
    inReview: number;
    inRepair: number;
    rejected: number;
    resolved: number;
  };
};

@Injectable()
export class ProfileService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) { }

  async getProfile(userId: string): Promise<FullUserProfile> {
    const client = this.supabaseService.getAdminClient();

    const { data: userRow, error: userError } = await client
      .from('user')
      .select(
        'id, email, username, roles(role_name), profile(full_name, nickname, class, dob, profile_pict)',
      )
      .eq('id', userId)
      .maybeSingle();

    if (userError || !userRow) {
      throw new NotFoundException('Data pengguna tidak ditemukan.');
    }

    const row = userRow as unknown as UserProfileRow;
    const profile = first(row.profile);
    const role = toUserRole(first(row.roles)?.role_name);

    let schoolInfo = {
      name: 'Belum Terhubung Sekolah',
      address: '-',
      npsn: '-',
      principal: '-',
      phone: '-',
      accreditation: '-',
    };

    try {
      const [siswa, guru, staff] = await Promise.all([
        client
          .from('siswa')
          .select('school_id, school(id, school_name, school_code, school_address)')
          .eq('user_id', userId)
          .maybeSingle(),
        client
          .from('guru')
          .select('school_id, school(id, school_name, school_code, school_address)')
          .eq('user_id', userId)
          .maybeSingle(),
        client
          .from('staff')
          .select('school_id, school(id, school_name, school_code, school_address)')
          .eq('user_id', userId)
          .maybeSingle(),
      ]);

      const membership = siswa.data ?? guru.data ?? staff.data;
      const schoolData = membership?.school;
      const school = first(schoolData as Related<{
        id: string;
        school_name: string | null;
        school_code: string | null;
        school_address: string | null;
      }>);

      if (school) {
        schoolInfo = {
          name: school.school_name ?? 'Belum Terhubung Sekolah',
          address: school.school_address ?? '-',
          npsn: school.school_code ?? '-',
          principal: '-',
          phone: '-',
          accreditation: '-',
        };
      }
    } catch { }

    const authUser = await client.auth.admin
      .getUserById(userId)
      .then((r) => r.data?.user)
      .catch(() => null);

    const phone =
      (authUser?.user_metadata?.phone as string) ||
      authUser?.phone ||
      '';
    const gender = (authUser?.user_metadata?.gender as string) || '';

    const [reportsCountRes, votesRes, recommsRes, userReportsRes] =
      await Promise.all([
        client
          .from('report')
          .select('id', { count: 'exact', head: true })
          .eq('reporter_id', userId),
        client
          .from('reports_votes')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId),
        client
          .from('recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('guru_id', userId),
        client
          .from('report')
          .select('id, status(status_name)')
          .eq('reporter_id', userId),
      ]);

    let pendingConfirmation = 0;
    let inReview = 0;
    let inRepair = 0;
    let rejected = 0;
    let resolved = 0;

    for (const r of (userReportsRes.data ?? []) as Array<{
      status: Related<{ status_name: string | null }>;
    }>) {
      const s = (first(r.status)?.status_name ?? '').toLowerCase();
      if (s.includes('menunggu')) pendingConfirmation++;
      else if (s.includes('pemeriksaan')) inReview++;
      else if (s.includes('perbaikan')) inRepair++;
      else if (s.includes('tolak')) rejected++;
      else if (s.includes('selesai')) resolved++;
    }

    return {
      id: row.id,
      email: row.email,
      fullName:
        profile?.full_name ??
        (authUser?.user_metadata?.full_name as string) ??
        row.username ??
        row.email.split('@')[0],
      role,
      phone,
      birthDate: profile?.dob ?? '',
      gender,
      avatarUrl: profile?.profile_pict ?? null,
      classOrPosition: profile?.class ?? '',
      schoolInfo,
      stats: {
        reportsCreated: reportsCountRes.count ?? 0,
        votesCount: votesRes.count ?? 0,
        recommendationsCount: recommsRes.count ?? 0,
        pendingConfirmation,
        inReview,
        inRepair,
        rejected,
        resolved,
      },
    };
  }

  async updateProfile(
    userId: string,
    dto: UpdateProfileDto,
  ): Promise<FullUserProfile> {
    const client = this.supabaseService.getAdminClient();

    const profileUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    if (dto.fullName !== undefined) {
      profileUpdates.full_name = dto.fullName;
    }
    if (dto.classOrPosition !== undefined) {
      profileUpdates.class = dto.classOrPosition;
    }
    if (dto.birthDate !== undefined) {
      profileUpdates.dob = dto.birthDate;
    }
    if (dto.avatarUrl !== undefined) {
      profileUpdates.profile_pict = dto.avatarUrl;
    }

    const { error: profileError } = await client
      .from('profile')
      .upsert({ user_id: userId, ...profileUpdates }, { onConflict: 'user_id' });

    if (profileError) {
      throw new BadRequestException(
        `Gagal memperbarui profil: ${profileError.message}`,
      );
    }

    const metadataUpdates: Record<string, unknown> = {};
    if (dto.fullName !== undefined) metadataUpdates.full_name = dto.fullName;
    if (dto.phone !== undefined) metadataUpdates.phone = dto.phone;
    if (dto.gender !== undefined) metadataUpdates.gender = dto.gender;

    if (Object.keys(metadataUpdates).length > 0) {
      await client.auth.admin
        .updateUserById(userId, {
          user_metadata: metadataUpdates,
          ...(dto.phone ? { phone: dto.phone } : {}),
        })
        .catch(() => { });
    }

    return this.getProfile(userId);
  }

  async changePassword(
    userId: string,
    email: string | undefined,
    dto: ChangePasswordDto,
  ): Promise<{ message: string }> {
    let targetEmail = email;
    if (!targetEmail) {
      const userRes = await this.supabaseService
        .getAdminClient()
        .from('user')
        .select('email')
        .eq('id', userId)
        .maybeSingle();
      targetEmail = userRes.data?.email;
    }

    if (!targetEmail) {
      throw new BadRequestException('Email pengguna tidak ditemukan.');
    }

    const anon = this.supabaseService.createAnonClient();
    const { error: signInErr } = await anon.auth.signInWithPassword({
      email: targetEmail,
      password: dto.currentPassword,
    });

    if (signInErr) {
      throw new UnauthorizedException('Kata sandi saat ini tidak valid.');
    }

    const admin = this.supabaseService.getAdminClient();
    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: dto.newPassword,
    });

    if (updateErr) {
      throw new BadRequestException(
        updateErr.message ?? 'Gagal memperbarui kata sandi.',
      );
    }

    return { message: 'Kata sandi berhasil diperbarui.' };
  }
}
