import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { CreateEvaluasiDto } from './dto/create-evaluasi.dto';

type ReportStatusRelation = {
  status_name: string | null;
};

type ReportWithStatus = {
  id: string;
  status: ReportStatusRelation | ReportStatusRelation[] | null;
};

@Injectable()
export class ReportEvaluasiService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async create(user: AuthUser, reportId: string, dto: CreateEvaluasiDto) {
    const client = this.supabaseService.getAdminClient();

    const { data: reportData, error: reportError } = await client
      .from('report')
      .select('id, status:status_id(status_name)')
      .eq('id', reportId)
      .maybeSingle();

    if (reportError) throw reportError;

    if (!reportData) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    const report = reportData as unknown as ReportWithStatus;
    const statusRelation = report.status;

    const status = Array.isArray(statusRelation)
      ? statusRelation[0]?.status_name
      : statusRelation?.status_name;

    if (
      typeof status !== 'string' ||
      !['done', 'selesai'].includes(status.trim().toLowerCase())
    ) {
      throw new BadRequestException(
        'Evaluasi hanya dapat diberikan pada laporan yang selesai.',
      );
    }

    const { data: existing, error: existingError } = await client
      .from('evaluasi')
      .select('id')
      .eq('report_id', reportId)
      .eq('evaluator_id', user.id)
      .maybeSingle();

    if (existingError) throw existingError;

    if (existing) {
      throw new BadRequestException(
        'Kamu sudah memberikan evaluasi untuk laporan ini.',
      );
    }

    const { data, error } = await client
      .from('evaluasi')
      .insert({
        report_id: reportId,
        evaluator_id: user.id,
        rate: dto.rate,
        notes: dto.notes?.trim() || null,
      })
      .select('id, report_id, evaluator_id, rate, notes, created_at')
      .single();

    if (error) throw error;

    return {
      message: 'Evaluasi berhasil disimpan.',
      evaluation: data,
    };
  }

  async list(reportId: string) {
    const client = this.supabaseService.getAdminClient();

    const { data: report, error: reportError } = await client
      .from('report')
      .select('id')
      .eq('id', reportId)
      .maybeSingle();

    if (reportError) throw reportError;

    if (!report) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    const { data, error } = await client
      .from('evaluasi')
      .select('id, report_id, evaluator_id, rate, notes, created_at')
      .eq('report_id', reportId)
      .order('created_at', { ascending: false });

    if (error) throw error;

    return data ?? [];
  }
}
