import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import type { UpdateReportStatusDto } from './dto/update-report-status.dto';
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
      .eq('id', reportId);
    if (user.role !== 'administrator') {
      const schoolId = await this.schoolMembership.getSchoolId(user.id);
      reportQuery.eq('school_id', schoolId);
    }
    const [report, myVote] = await Promise.all([
      reportQuery.maybeSingle(),
      client
        .from('reports_votes')
        .select('id', { count: 'exact', head: true })
        .eq('report_id', reportId)
        .eq('user_id', user.id),
    ]);

    if (report.error) {
      throw report.error;
    }
    if (myVote.error) {
      throw myVote.error;
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
    }
    else if (
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
    );
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
      status_id: (status as { id: string }).id,
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
      .eq('id', reportId);
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

    return toReportDetail(data as unknown as ReportDetailRow, false);
  }
}
