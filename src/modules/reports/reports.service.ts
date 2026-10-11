import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CloudinaryService } from '../../cloudinary/cloudinary.service';
import type { AuthUser } from '../../common/interfaces/auth-user.interface';
import { SupabaseService } from '../../supabase/supabase.service';
import { REPORT_IMAGE_FOLDER } from '../uploads/uploads.constants';
import { CreateReportDto } from './dto/create-report.dto';
import type { ReportResponse, ReportRow } from './reports.types';
import { SchoolMembershipService } from '../schools/school-membership.service';

const FOREIGN_KEY_VIOLATION = '23503';

@Injectable()
export class ReportsService {
  private readonly logger = new Logger(ReportsService.name);
  private readonly table = 'report';

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly cloudinaryService: CloudinaryService,
    private readonly configService: ConfigService,
    private readonly schoolMembership: SchoolMembershipService,
  ) {}

  async create(user: AuthUser, dto: CreateReportDto): Promise<ReportResponse> {
    if (dto.imageUrl) {
      this.assertOwnImage(dto.imageUrl, dto.imagePublicId);
    }

    const [schoolId] = await Promise.all([
      this.schoolMembership.getSchoolId(user.id),
      this.assertCategoryExists(dto.categoryId),
    ]);

    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .insert({
        reporter_id: user.id,
        school_id: schoolId,
        title: dto.title.trim(),
        description: dto.description.trim(),
        location: dto.location.trim(),
        category_id: dto.categoryId,
        broken_date: dto.brokenDate.slice(0, 10),
        image_url: dto.imageUrl ?? null,
        image_public_id: dto.imagePublicId ?? null,
      })
      .select(
        'id, reporter_id, school_id, title, description, location, broken_date, category_id, status_id, image_url, is_validate, created_at',
      )
      .single();

    if (error || !data) {
      if (dto.imagePublicId) {
        await this.cloudinaryService.deleteImage(dto.imagePublicId);
      }
      if (error?.code === FOREIGN_KEY_VIOLATION) {
        this.logger.warn(`Report insert FK violation: ${error.message}`);
        throw new ForbiddenException('Akun kamu belum terdaftar di sistem.');
      }
      throw error ?? new Error('Failed to create report');
    }

    return this.toResponse(data);
  }

  private async assertCategoryExists(categoryId: string): Promise<void> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('category')
      .select('id')
      .eq('id', categoryId)
      .maybeSingle();

    if (error) {
      throw error;
    }
    if (!data) {
      throw new BadRequestException('Kategori tidak ditemukan.');
    }
  }

  private assertOwnImage(imageUrl: string, publicId?: string): void {
    const cloudName = this.configService.getOrThrow<string>(
      'cloudinary.cloudName',
    );
    const url = new URL(imageUrl);
    const isOwnHost =
      url.hostname === 'res.cloudinary.com' &&
      url.pathname.startsWith(`/${cloudName}/`);
    const isReportImage =
      !!publicId &&
      publicId.startsWith(`${REPORT_IMAGE_FOLDER}/`) &&
      url.pathname.includes(publicId);

    if (!isOwnHost || !isReportImage) {
      throw new BadRequestException('Foto laporan tidak valid.');
    }
  }

  private toResponse(row: ReportRow): ReportResponse {
    return {
      id: row.id,
      title: row.title,
      description: row.description,
      location: row.location,
      brokenDate: row.broken_date,
      categoryId: row.category_id,
      statusId: row.status_id,
      imageUrl: row.image_url,
      isValidated: row.is_validate,
      createdAt: row.created_at,
    };
  }
}
