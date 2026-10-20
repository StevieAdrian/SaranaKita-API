import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuthUser } from 'src/common/interfaces/auth-user.interface';
import { SupabaseService } from 'src/supabase/supabase.service';
import { CreateReportNoteDto } from './dto/create-report-note.dto';

const NOTE_DELAY_MS = 15 * 60 * 1000;

@Injectable()
export class ReportNotesService {
  constructor(private readonly supabaseService: SupabaseService) {}

  private get client() {
    return this.supabaseService.getAdminClient();
  }

  private async getOwnedReport(user: AuthUser, reportId: string) {
    const { data: report, error } = await this.client
      .from('report')
      .select('id, reporter_id, created_at')
      .eq('id', reportId)
      .maybeSingle();

    if (error) throw error;

    if (!report) {
      throw new NotFoundException('Laporan tidak ditemukan.');
    }

    const createdAt = new Date(report.created_at).getTime();

    if (!Number.isFinite(createdAt) || Date.now() < createdAt + NOTE_DELAY_MS) {
      throw new ForbiddenException(
        'Catatan hanya dapat dibuat setelah 15 menit sejak laporan dibuat.',
      );
    }

    return report;
  }

  async create(user: AuthUser, reportId: string, dto: CreateReportNoteDto) {
    await this.getOwnedReport(user, reportId);

    const noteText = dto.note_text.trim();

    if (!noteText) {
      throw new BadRequestException('Catatan tidak boleh kosong.');
    }

    if (noteText.length > 300) {
      throw new BadRequestException('Catatan maksimal 300 karakter.');
    }

    const { data: existing, error: findError } = await this.client
      .from('reports_notes')
      .select('id')
      .eq('report_id', reportId)
      .maybeSingle();

    if (findError) throw findError;

    if (existing) {
      throw new BadRequestException(
        'Laporan ini sudah memiliki catatan. Silakan ubah catatan yang ada.',
      );
    }

    const { data, error } = await this.client
      .from('reports_notes')
      .insert({
        report_id: reportId,
        author_id: user.id,
        note_text: noteText,
      })
      .select('id, report_id, author_id, note_text, created_at')
      .single();

    if (error) throw error;

    return data;
  }

  async update(user: AuthUser, reportId: string, dto: CreateReportNoteDto) {
    await this.getOwnedReport(user, reportId);

    const noteText = dto.note_text.trim();

    if (!noteText) {
      throw new BadRequestException('Catatan tidak boleh kosong.');
    }

    if (noteText.length > 300) {
      throw new BadRequestException('Catatan maksimal 300 karakter.');
    }

    const { data: existing, error: findError } = await this.client
      .from('reports_notes')
      .select('id, author_id')
      .eq('report_id', reportId)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      throw new NotFoundException('Catatan tidak ditemukan.');
    }

    if (existing.author_id !== user.id) {
      throw new ForbiddenException(
        'Kamu hanya dapat mengubah catatan milikmu sendiri.',
      );
    }

    const { data, error } = await this.client
      .from('reports_notes')
      .update({ note_text: noteText })
      .eq('id', existing.id)
      .eq('author_id', user.id)
      .select('id, report_id, author_id, note_text, created_at')
      .single();

    if (error) throw error;

    return data;
  }

  async remove(user: AuthUser, reportId: string) {
    await this.getOwnedReport(user, reportId);

    const { data: existing, error: findError } = await this.client
      .from('reports_notes')
      .select('id, author_id')
      .eq('report_id', reportId)
      .maybeSingle();

    if (findError) throw findError;

    if (!existing) {
      throw new NotFoundException('Catatan tidak ditemukan.');
    }

    if (existing.author_id !== user.id) {
      throw new ForbiddenException(
        'Kamu hanya dapat menghapus catatan milikmu sendiri.',
      );
    }

    const { error } = await this.client
      .from('reports_notes')
      .delete()
      .eq('id', existing.id)
      .eq('author_id', user.id);

    if (error) throw error;

    return { message: 'Catatan berhasil dihapus.' };
  }
}
