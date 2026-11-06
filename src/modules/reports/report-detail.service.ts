import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import type { UpdateReportStatusDto } from './dto/update-report-status.dto';
import type { SupabaseClient } from '@supabase/supabase-js';
import {
  REPORT_DETAIL_SELECT,
  toReportDetail,
  type ReportDetail,
  type ReportDetailRow,
} from './report-detail.mapper';

@Injectable()
export class ReportDetailService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) { }

  async findOne(user: AuthUser, reportId: string): Promise<ReportDetail> {
    const client = this.supabaseService.getAdminClient();
    const reportQuery = client
      .from('report')
      .select(REPORT_DETAIL_SELECT)
      .eq('id', reportId)
      .eq('is_delete', false);
    if (user.role !== 'administrator') {
      const schoolId = await this.schoolMembership.getSchoolId(user.id);
      reportQuery.eq('school_id', schoolId);
    }
    const [report, myVote, myRecommendation] = await Promise.all([
      reportQuery.maybeSingle(),
      client
        .from('reports_votes')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('user_id', user.id),
      user.role === 'guru'
        ? client
          .from('recommendations')
          .select('id', { count: 'exact', head: true })
          .eq('report_id', reportId)
          .eq('guru_id', user.id)
        : Promise.resolve({ count: 0, error: null }),
    ]);

    if (report.error) {
      throw report.error;
    }
    if (myVote.error) {
      throw myVote.error;
    }
    if (myRecommendation.error) {
      throw myRecommendation.error;
    }
    if (!report.data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    const row = report.data as unknown as ReportDetailRow;
    const statusName = (Array.isArray(row.status) ? row.status[0] : row.status)?.status_name;

    if (statusName === 'Ditolak' && !row.rejected_by && row.updated_by) {
      await client
        .from('report')
        .update({ rejected_by: row.updated_by })
        .eq('id', reportId);
      row.rejected_by = row.updated_by;
    } else if (
      statusName &&
      statusName !== 'Menunggu Verifikasi' &&
      statusName !== 'Ditolak' &&
      !row.verified_by &&
      row.updated_by
    ) {
      await client
        .from('report')
        .update({ verified_by: row.updated_by })
        .eq('id', reportId);
      row.verified_by = row.updated_by;
    }

    return toReportDetail(
      row,
      (myVote.count ?? 0) > 0,
      (myRecommendation.count ?? 0) > 0,
    );
  }

  async listVotes(user: AuthUser, reportId: string) {
    const client = this.supabaseService.getAdminClient();
    const reportQuery = client.from('report').select('id').eq('id', reportId);
    if (user.role !== 'administrator') {
      const schoolId = await this.schoolMembership.getSchoolId(user.id);
      reportQuery.eq('school_id', schoolId);
    }
    const { data: report, error: reportError } = await reportQuery.maybeSingle();
    if (reportError) throw reportError;
    if (!report) throw new NotFoundException('Laporan tidak ditemukan.');

    const { data, error } = await client
      .from('reports_votes')
      .select('user_id')
      .eq('report_id', reportId);
    if (error) throw error;
    return this.listUsers((data ?? []).map((row) => row.user_id), client);
  }

  async listRecommendations(user: AuthUser, reportId: string) {
    const client = this.supabaseService.getAdminClient();
    const reportQuery = client.from('report').select('id').eq('id', reportId);
    if (user.role !== 'administrator') {
      const schoolId = await this.schoolMembership.getSchoolId(user.id);
      reportQuery.eq('school_id', schoolId);
    }
    const { data: report, error: reportError } = await reportQuery.maybeSingle();
    if (reportError) throw reportError;
    if (!report) throw new NotFoundException('Laporan tidak ditemukan.');

    const { data, error } = await client
      .from('recommendations')
      .select('guru_id, reason')
      .eq('report_id', reportId);
    if (error) throw error;
    const users = await this.listUsers(
      (data ?? []).map((row) => row.guru_id),
      client,
    );
    const byId = new Map(users.map((item) => [item.id, item]));
    return (data ?? []).map((row) => ({
      ...byId.get(row.guru_id),
      reason: row.reason,
    }));
  }

  private async listUsers(userIds: string[], client: SupabaseClient) {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return [];
    const { data, error } = await client
      .from('user')
      .select('id, username, profile(full_name, profile_pict)')
      .in('id', ids);
    if (error) throw error;
    return (data ?? []).map((row) => {
      const profile = Array.isArray(row.profile) ? row.profile[0] : row.profile;
      return {
        id: row.id,
        name: profile?.full_name?.trim() || row.username || 'Pengguna',
        avatarUrl: profile?.profile_pict || null,
      };
    });
  }

  async updateStatus(
    user: AuthUser,
    reportId: string,
    dto: UpdateReportStatusDto,
  ): Promise<ReportDetail> {
    const client = this.supabaseService.getAdminClient();
    const { data: status, error: statusError } = await client
      .from('status')
      .select('id')
      .eq('status_name', dto.statusName)
      .maybeSingle();

    if (statusError) {
      throw statusError;
    }
    if (!status) {
      throw new BadRequestException('Status laporan tidak ditemukan.');
    }

    const updatePayload: Record<string, unknown> = {
      status_id: status.id,
      is_validate: dto.statusName !== 'Menunggu Verifikasi',
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    };

    if (dto.statusName === 'Ditolak') {
      updatePayload.rejected_by = user.id;
    } else if (dto.statusName !== 'Menunggu Verifikasi') {
      updatePayload.verified_by = user.id;
    }

    const reportQuery = client
      .from('report')
      .update(updatePayload)
      .eq('id', reportId)
      .eq('is_delete', false);
    if (user.role !== 'administrator') {
      const schoolId = await this.schoolMembership.getSchoolId(user.id);
      reportQuery.eq('school_id', schoolId);
    }
    const { data, error } = await reportQuery
      .select(REPORT_DETAIL_SELECT)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    return toReportDetail(data as unknown as ReportDetailRow, false, false);
  }
}
