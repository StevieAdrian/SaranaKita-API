import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { toUserRole, type UserRole } from '../../common/utils/resolve-role';
import { SupabaseService } from '../../supabase/supabase.service';
import { SchoolMembershipService } from '../schools/school-membership.service';
import type { CreateReportCommentDto } from './dto/create-report-comment.dto';

type Related<T> = T | T[] | null | undefined;

type CommentRow = {
  id: string;
  report_id: string;
  user_id: string;
  comment_text: string;
  created_at: string;
};

type UserRow = {
  id: string;
  username: string | null;
  roles: Related<{ role_name: string | null }>;
  profile: Related<{ full_name: string | null; profile_pict: string | null }>;
};

export type ReportComment = {
  id: string;
  reportId: string;
  userId: string;
  authorName: string;
  authorRole: UserRole | null;
  avatarUrl: string | null;
  commentText: string;
  createdAt: string;
};

function first<T>(value: Related<T>): T | null {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

@Injectable()
export class ReportCommentsService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async list(user: AuthUser, reportId: string): Promise<ReportComment[]> {
    if (user.role !== 'administrator') {
      await this.assertReportInUserSchool(user.id, reportId);
    } else {
      await this.assertReportExists(reportId);
    }
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('reports_comments')
      .select('id, report_id, user_id, comment_text, created_at')
      .eq('report_id', reportId)
      .order('created_at', { ascending: true });

    if (error) {
      throw error;
    }
    return this.withAuthors((data ?? []) as CommentRow[]);
  }

  async create(
    user: AuthUser,
    reportId: string,
    dto: CreateReportCommentDto,
  ): Promise<ReportComment> {
    const commentText = dto.commentText.trim();
    if (!commentText) {
      throw new BadRequestException('Komentar tidak boleh kosong.');
    }

    await this.assertReportInUserSchool(user.id, reportId);
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('reports_comments')
      .insert({
        report_id: reportId,
        user_id: user.id,
        comment_text: commentText,
      })
      .select('id, report_id, user_id, comment_text, created_at')
      .single();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new Error('Gagal menyimpan komentar.');
    }

    const [comment] = await this.withAuthors([data as CommentRow]);
    return comment;
  }

  private async assertReportInUserSchool(
    userId: string,
    reportId: string,
  ): Promise<void> {
    const schoolId = await this.schoolMembership.getSchoolId(userId);
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('report')
      .select('id')
      .eq('id', reportId)
      .eq('school_id', schoolId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }
  }

  private async assertReportExists(reportId: string): Promise<void> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('report')
      .select('id')
      .eq('id', reportId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }
  }

  private async withAuthors(rows: CommentRow[]): Promise<ReportComment[]> {
    if (rows.length === 0) {
      return [];
    }
    const userIds = [...new Set(rows.map((row) => row.user_id))];
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .select(
        'id, username, roles(role_name), profile(full_name, profile_pict)',
      )
      .in('id', userIds);

    if (error) {
      throw error;
    }

    const users = new Map(
      ((data ?? []) as UserRow[]).map((row) => [row.id, row]),
    );
    return rows.map((row) => {
      const author = users.get(row.user_id);
      const profile = first(author?.profile);
      return {
        id: row.id,
        reportId: row.report_id,
        userId: row.user_id,
        authorName:
          profile?.full_name?.trim() || author?.username?.trim() || 'Pengguna',
        authorRole: toUserRole(first(author?.roles)?.role_name),
        avatarUrl: profile?.profile_pict?.trim() || null,
        commentText: row.comment_text,
        createdAt: row.created_at,
      };
    });
  }
}
