import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { CloudinaryService } from '../../cloudinary/cloudinary.service';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { CreateReportDto } from './dto/create-report.dto';
import { ReportsService } from './reports.service';
import { SchoolMembershipService } from '../schools/school-membership.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));
jest.mock('../../cloudinary/cloudinary.service', () => ({
  CloudinaryService: class {},
}));
jest.mock('@nestjs/config', () => ({ ConfigService: class {} }));

type Result = { data: unknown; error: unknown };

function chain(result: Result) {
  const c: Record<string, jest.Mock> = {};
  for (const method of ['select', 'eq', 'limit', 'insert']) {
    c[method] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  c.single = jest.fn().mockResolvedValue(result);
  return c;
}

const USER = { id: 'user-1' };
const CLOUD = 'demo';
const PUBLIC_ID = 'saranakita/reports/abc123';
const IMAGE_URL = `https://res.cloudinary.com/${CLOUD}/image/upload/v1/${PUBLIC_ID}.jpg`;

const baseDto: CreateReportDto = {
  title: ' Proyektor Rusak ',
  description: 'Proyektor tidak menyala sejak pagi.',
  location: 'Ruang 12B',
  categoryId: '11111111-1111-4111-8111-111111111111',
  brokenDate: '2025-09-15T08:00:00.000Z',
};

const insertedRow = {
  id: 'report-1',
  reporter_id: USER.id,
  school_id: 'school-1',
  title: 'Proyektor Rusak',
  description: baseDto.description,
  location: baseDto.location,
  broken_date: '2025-09-15',
  category_id: baseDto.categoryId,
  status_id: null,
  image_url: null,
  is_validate: false,
  created_at: '2025-09-15T08:00:00Z',
};

function setup(overrides: Partial<Record<string, Result>> = {}) {
  const chains: Record<string, ReturnType<typeof chain>> = {
    siswa: chain(
      overrides.siswa ?? { data: { school_id: 'school-1' }, error: null },
    ),
    guru: chain(overrides.guru ?? { data: null, error: null }),
    staff: chain(overrides.staff ?? { data: null, error: null }),
    category: chain(
      overrides.category ?? { data: { id: baseDto.categoryId }, error: null },
    ),
    report: chain(overrides.report ?? { data: insertedRow, error: null }),
  };
  const supabase = {
    getAdminClient: () => ({ from: (table: string) => chains[table] }),
  } as unknown as SupabaseService;
  const deleteImage = jest.fn().mockResolvedValue(undefined);
  const cloudinary = { deleteImage } as unknown as CloudinaryService;
  const config = { getOrThrow: () => CLOUD } as unknown as ConfigService;
  return {
    service: new ReportsService(
      supabase,
      cloudinary,
      config,
      new SchoolMembershipService(supabase),
    ),
    chains,
    deleteImage,
  };
}

describe('ReportsService.create', () => {
  it('inserts a trimmed report linked to the user school', async () => {
    const { service, chains } = setup();

    const result = await service.create(USER, baseDto);

    expect(chains.report.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        reporter_id: USER.id,
        school_id: 'school-1',
        title: 'Proyektor Rusak',
        broken_date: '2025-09-15',
        image_url: null,
      }),
    );
    expect(result).toMatchObject({ id: 'report-1', isValidated: false });
  });

  it('rejects users without a school', async () => {
    const { service } = setup({ siswa: { data: null, error: null } });
    await expect(service.create(USER, baseDto)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an unknown category', async () => {
    const { service } = setup({ category: { data: null, error: null } });
    await expect(service.create(USER, baseDto)).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects images that are not from our Cloudinary folder', async () => {
    const { service } = setup();
    await expect(
      service.create(USER, {
        ...baseDto,
        imageUrl: 'https://evil.example.com/x.jpg',
        imagePublicId: PUBLIC_ID,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('deletes the uploaded image when the insert fails', async () => {
    const { service, deleteImage } = setup({
      report: { data: null, error: { code: '23503', message: 'fk' } },
    });
    await expect(
      service.create(USER, {
        ...baseDto,
        imageUrl: IMAGE_URL,
        imagePublicId: PUBLIC_ID,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(deleteImage).toHaveBeenCalledWith(PUBLIC_ID);
  });
});
