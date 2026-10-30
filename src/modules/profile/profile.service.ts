import { BadRequestException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
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
  firstName?: string;
  lastName?: string;
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
    reportsRejected?: number;
    reportsVerified?: number;
    'Menunggu Verifikasi': number;
    'Dalam Pemeriksaan': number;
    'Dalam Perbaikan': number;
    'Selesai': number;
    'Ditolak': number;
  };
};

@Injectable()
export class ProfileService {
  private readonly logger = new Logger(ProfileService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) { }

  async getProfile(userId: string): Promise<FullUserProfile> {
    const client = this.supabaseService.getAdminClient();

    const { data: userRows, error: userError } = await client
      .from('user')
      .select(
        'id, email, username, roles(role_name), profile(full_name, nickname, class, dob, profile_pict)',
      )
      .eq('id', userId)
      .limit(1);

    const userRow = userRows?.[0];
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

    let schoolId: string | null = null;

    try {
      const [siswa, guru, staff] = await Promise.all([
        client
          .from('siswa')
          .select('school_id, school(*)')
          .eq('user_id', userId)
          .limit(1),
        client
          .from('guru')
          .select('school_id, school(*)')
          .eq('user_id', userId)
          .limit(1),
        client
          .from('staff')
          .select('school_id, school(*)')
          .eq('user_id', userId)
          .limit(1),
      ]);

      const membership = siswa.data?.[0] ?? guru.data?.[0] ?? staff.data?.[0];
      schoolId = membership?.school_id ?? null;
      const schoolData = membership?.school;
      const school = first(
        schoolData as Related<{
          id: string;
          school_name: string | null;
          school_address: string | null;
          npsn?: string | null;
          principal?: string | null;
          phone?: string | null;
          accreditation?: string | null;
        }>,
      );

      if (school) {
        schoolInfo = {
          name: school.school_name ?? 'Belum Terhubung Sekolah',
          address: school.school_address ?? '-',
          npsn: school.npsn ?? '-',
          principal: school.principal ?? '-',
          phone: school.phone ?? '-',
          accreditation: school.accreditation ?? '-',
        };
      }
    } catch { }

    const authUser = await client.auth.admin
      .getUserById(userId)
      .then((r) => r.data?.user)
      .catch(() => null);

    const phone =
      (authUser?.user_metadata?.phone as string) || authUser?.phone || '';
    const gender = (authUser?.user_metadata?.gender as string) || '';
    const firstName =
      (authUser?.user_metadata?.first_name as string) || undefined;
    const lastName =
      (authUser?.user_metadata?.last_name as string) || undefined;

    const isStaff = role === 'staff';
    const isAdmin = role === 'administrator';
    const isStaffOrAdmin = isStaff || isAdmin;

    let statusReportsQuery = client
      .from('report')
      .select('id, status(status_name)');
    if (isStaffOrAdmin && schoolId) {
      statusReportsQuery = statusReportsQuery.eq('school_id', schoolId);
    } else if (!isStaffOrAdmin) {
      statusReportsQuery = statusReportsQuery.eq('reporter_id', userId);
    }

    if (isStaffOrAdmin) {
      await this.reconcileReviewers(client, schoolId);
    }

    const [
      reportsCountRes,
      votesRes,
      recommsRes,
      statusReportsRes,
      staffRejectedRes,
      staffVerifiedRes,
    ] = await Promise.all([
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
      statusReportsQuery,
      client
        .from('report')
        .select('id', { count: 'exact', head: true })
        .eq('rejected_by', userId),
      client
        .from('report')
        .select('id', { count: 'exact', head: true })
        .eq('verified_by', userId),
    ]);

    const statusCounts = {
      'Menunggu Verifikasi': 0,
      'Dalam Pemeriksaan': 0,
      'Dalam Perbaikan': 0,
      'Selesai': 0,
      'Ditolak': 0,
    };

    for (const r of (statusReportsRes.data ?? []) as Array<{
      status: Related<{ status_name: string | null }>;
    }>) {
      const s = (first(r.status)?.status_name ?? '').toLowerCase();
      if (s.includes('menunggu') || !s) statusCounts['Menunggu Verifikasi']++;
      else if (s.includes('pemeriksaan')) statusCounts['Dalam Pemeriksaan']++;
      else if (s.includes('perbaikan')) statusCounts['Dalam Perbaikan']++;
      else if (s.includes('selesai')) statusCounts['Selesai']++;
      else if (s.includes('tolak')) statusCounts['Ditolak']++;
    }

    const finalRejected = isStaff
      ? (staffRejectedRes.count ?? 0)
      : statusCounts['Ditolak'];
    const finalVerified = isStaff
      ? (staffVerifiedRes.count ?? 0)
      : statusCounts['Selesai'];

    return {
      id: row.id,
      email: row.email,
      fullName:
        profile?.full_name ??
        (authUser?.user_metadata?.full_name as string) ??
        row.username ??
        row.email.split('@')[0],
      firstName,
      lastName,
      role,
      phone,
      birthDate: profile?.dob ?? '',
      gender,
      avatarUrl: profile?.profile_pict ?? null,
      classOrPosition:
        profile?.class ||
        (authUser?.user_metadata?.classOrPosition as string) ||
        (authUser?.user_metadata?.jabatan as string) ||
        (authUser?.user_metadata?.class_grade as string) ||
        '',
      schoolInfo,
      stats: {
        reportsCreated: reportsCountRes.count ?? 0,
        votesCount: votesRes.count ?? 0,
        recommendationsCount: recommsRes.count ?? 0,
        reportsRejected: staffRejectedRes.count ?? 0,
        reportsVerified: staffVerifiedRes.count ?? 0,
        'Menunggu Verifikasi': statusCounts['Menunggu Verifikasi'],
        'Dalam Pemeriksaan': statusCounts['Dalam Pemeriksaan'],
        'Dalam Perbaikan': statusCounts['Dalam Perbaikan'],
        'Selesai': finalVerified,
        'Ditolak': finalRejected,
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
      .upsert(
        { user_id: userId, ...profileUpdates },
        { onConflict: 'user_id' },
      );

    if (profileError) {
      throw new BadRequestException(
        `Gagal memperbarui profil: ${profileError.message}`,
      );
    }

    const metadataUpdates: Record<string, unknown> = {};
    if (dto.fullName !== undefined) metadataUpdates.full_name = dto.fullName;
    if (dto.firstName !== undefined) metadataUpdates.first_name = dto.firstName;
    if (dto.lastName !== undefined) metadataUpdates.last_name = dto.lastName;
    if (dto.phone !== undefined) metadataUpdates.phone = dto.phone;
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
    if (dto.classOrPosition !== undefined) {
      metadataUpdates.classOrPosition = dto.classOrPosition;
      metadataUpdates.jabatan = dto.classOrPosition;
      metadataUpdates.class_grade = dto.classOrPosition;
    }

    if (Object.keys(metadataUpdates).length > 0) {
      const existingUser = await client.auth.admin
        .getUserById(userId)
        .then((r) => r.data?.user)
        .catch(() => null);

      const mergedMetadata = {
        ...(existingUser?.user_metadata ?? {}),
        ...metadataUpdates,
      };

      await client.auth.admin
        .updateUserById(userId, {
          user_metadata: mergedMetadata,
        })
        .catch((err) => {
          this.logger.warn(`Failed to update user_metadata: ${err?.message}`);
        });
    }

    return this.getProfile(userId);
  }

  async changePassword(
    userId: string,
    email: string | undefined,
    dto: ChangePasswordDto,
  ): Promise<{
    message: string;
    tokens?: { accessToken: string; refreshToken: string };
  }> {
    const admin = this.supabaseService.getAdminClient();
    let targetEmail = email?.trim().toLowerCase();
    if (!targetEmail) {
      const authUserRes = await admin.auth.admin
        .getUserById(userId)
        .catch(() => null);
      targetEmail = authUserRes?.data?.user?.email?.trim().toLowerCase();
    }
    if (!targetEmail) {
      const userRes = await admin
        .from('user')
        .select('email')
        .eq('id', userId)
        .limit(1);
      targetEmail = userRes.data?.[0]?.email?.trim().toLowerCase();
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

    const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
      password: dto.newPassword,
    });

    if (updateErr) {
      throw new BadRequestException(
        updateErr.message ?? 'Gagal memperbarui kata sandi.',
      );
    }

    let freshTokens: { accessToken: string; refreshToken: string } | undefined;
    try {
      const { data: newSessionData } = await anon.auth.signInWithPassword({
        email: targetEmail,
        password: dto.newPassword,
      });
      if (newSessionData?.session) {
        freshTokens = {
          accessToken: newSessionData.session.access_token,
          refreshToken: newSessionData.session.refresh_token,
        };
      }
    } catch (err: any) {
      this.logger.warn(
        `Gagal membuat token sesi baru setelah perubahan kata sandi: ${err?.message || err}`,
      );
    }

    return {
      message: 'Kata sandi berhasil diperbarui.',
      ...(freshTokens ? { tokens: freshTokens } : {}),
    };
  }

  private async reconcileReviewers(
    client: any,
    schoolId: string | null,
  ): Promise<void> {
    try {
      let rejectedQuery = client
        .from('report')
        .select('id, updated_by, status!inner(status_name)')
        .is('rejected_by', null)
        .not('updated_by', 'is', null)
        .eq('status.status_name', 'Ditolak');

      if (schoolId) {
        rejectedQuery = rejectedQuery.eq('school_id', schoolId);
      }

      let verifiedQuery = client
        .from('report')
        .select('id, updated_by, status!inner(status_name)')
        .is('verified_by', null)
        .not('updated_by', 'is', null)
        .neq('status.status_name', 'Menunggu Verifikasi')
        .neq('status.status_name', 'Ditolak');

      if (schoolId) {
        verifiedQuery = verifiedQuery.eq('school_id', schoolId);
      }

      const [unlinkedRejectedRes, unlinkedVerifiedRes] = await Promise.all([
        rejectedQuery,
        verifiedQuery,
      ]);

      const updates: Promise<any>[] = [];

      for (const r of (unlinkedRejectedRes.data ?? []) as Array<{
        id: string;
        updated_by: string;
      }>) {
        if (r.updated_by) {
          updates.push(
            client
              .from('report')
              .update({ rejected_by: r.updated_by })
              .eq('id', r.id),
          );
        }
      }

      for (const r of (unlinkedVerifiedRes.data ?? []) as Array<{
        id: string;
        updated_by: string;
      }>) {
        if (r.updated_by) {
          updates.push(
            client
              .from('report')
              .update({ verified_by: r.updated_by })
              .eq('id', r.id),
          );
        }
      }

      if (updates.length > 0) {
        await Promise.all(updates);
      }
    } catch (err: any) {
      this.logger.warn(`reconcileReviewers error: ${err?.message || err}`);
    }
  }
}
