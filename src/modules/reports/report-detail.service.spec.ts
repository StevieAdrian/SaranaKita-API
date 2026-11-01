import { NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SchoolMembershipService } from '../schools/school-membership.service';
import { toReportDetail, type ReportDetailRow } from './report-detail.mapper';
import { ReportDetailService } from './report-detail.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class { },
}));
jest.mock('../schools/school-membership.service', () => ({
  SchoolMembershipService: class { },
}));

const row: ReportDetailRow = {
  id: 'r1',
  title: 'Proyektor Kelas 11B Bermasalah',
  description: 'Sering mati',
  location: 'XII B',
  broken_date: '2026-07-23',
  image_url: 'https://res.cloudinary.com/demo/image/upload/a.jpg',
  created_at: '2026-07-24T01:00:00Z',
  updated_at: '2026-07-25T01:00:00Z',
  status: { status_name: 'Dalam Perbaikan' },
  category: { id: 'c1', category_name: 'Fasilitas' },
  reporter: {
    username: 'alicia',
    roles: { role_name: 'Siswa' },
    profile: [
      { full_name: 'Alicia Felisha', class: 'XII B', profile_pict: null },
    ],
  },
  reports_votes: [{ count: 34 }],
  reports_comments: [{ count: 6 }],
  recommendations: [{ count: 11 }],
  verified_by: null,
  rejected_by: null,
  updated_by: null,
  reports_notes: [],
};

describe('toReportDetail', () => {
  it('maps nested relations', () => {
    expect(toReportDetail(row, true)).toEqual({
      id: 'r1',
      title: 'Proyektor Kelas 11B Bermasalah',
      description: 'Sering mati',
      location: 'XII B',
      brokenDate: '2026-07-23',
      category: { id: 'c1', name: 'Fasilitas' },
      status: 'in_repair',
      imageUrls: ['https://res.cloudinary.com/demo/image/upload/a.jpg'],
      reporter: {
        name: 'Alicia Felisha',
        role: 'siswa',
        className: 'XII B',
        avatarUrl: null,
      },
      createdAt: '2026-07-24T01:00:00Z',
      votes: 34,
      comments: 6,
      recommendations: 11,
      votedByMe: true,
      recommendedByMe: false,
      timeline: [
        { type: 'in_repair', at: '2026-07-25T01:00:00Z' },
        { type: 'created', at: '2026-07-24T01:00:00Z' },
      ],
      verifiedBy: null,
      rejectedBy: null,
      updatedBy: null,
      note: null,
    });
  });

  it('has only the created event while waiting for verification', () => {
    const detail = toReportDetail(
      { ...row, status: null, image_url: null, category: null },
      false,
    );
    expect(detail.status).toBe('waiting_verification');
    expect(detail.timeline).toEqual([
      { type: 'created', at: '2026-07-24T01:00:00Z' },
    ]);
    expect(detail.imageUrls).toEqual([]);
    expect(detail.category).toBeNull();
  });

  it('falls back to username and unknown role', () => {
    const detail = toReportDetail(
      { ...row, reporter: { username: 'stevie', roles: null, profile: null } },
      false,
    );
    expect(detail.reporter).toEqual({
      name: 'stevie',
      role: null,
      className: null,
      avatarUrl: null,
    });
  });

  it('passes recommendedByMe flag when true', () => {
    const detail = toReportDetail(row, false, true);
    expect(detail.recommendedByMe).toBe(true);
  });
});

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of ['select', 'eq', 'update']) {
    c[method] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  c.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

function setup(
  report: { data: unknown; error: unknown },
  voteCount = 0,
  recommendationCount = 0,
) {
  const chains = {
    report: chain(report),
    reports_votes: chain({ count: voteCount, error: null }),
    recommendations: chain({ count: recommendationCount, error: null }),
    status: chain({ data: { id: 'status-1' }, error: null }),
  };
  const supabase = {
    getAdminClient: () => ({
      from: (table: keyof typeof chains) => chains[table],
    }),
  } as unknown as SupabaseService;
  const membership = {
    getSchoolId: jest.fn().mockResolvedValue('school-1'),
  } as unknown as SchoolMembershipService;
  return { service: new ReportDetailService(supabase, membership), chains };
}

describe('ReportDetailService.findOne', () => {
  const user = { id: 'user-1' };

  it('scopes to the user school and returns votedByMe', async () => {
    const { service, chains } = setup({ data: row, error: null }, 1);
    const detail = await service.findOne(user, 'r1');

    expect(chains.report.eq).toHaveBeenCalledWith('id', 'r1');
    expect(chains.report.eq).toHaveBeenCalledWith('school_id', 'school-1');
    expect(chains.reports_votes.eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(detail.votedByMe).toBe(true);
    expect(detail.recommendedByMe).toBe(false);
  });

  it('queries recommendations and returns recommendedByMe as true for guru', async () => {
    const guruUser = { id: 'guru-1', role: 'guru' as const };
    const { service, chains } = setup({ data: row, error: null }, 0, 1);
    const detail = await service.findOne(guruUser, 'r1');

    expect(chains.recommendations.select).toHaveBeenCalledWith('id', {
      count: 'exact',
      head: true,
    });
    expect(chains.recommendations.eq).toHaveBeenCalledWith('guru_id', 'guru-1');
    expect(chains.recommendations.eq).toHaveBeenCalledWith('report_id', 'r1');
    expect(detail.recommendedByMe).toBe(true);
  });

  it('throws NotFound for reports in other schools', async () => {
    const { service } = setup({ data: null, error: null });
    await expect(service.findOne(user, 'r9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('reconciles missing rejected_by when status is Ditolak and updated_by is present', async () => {
    const rejectedRow = {
      ...row,
      status: { status_name: 'Ditolak' },
      rejected_by: null,
      updated_by: 'staff-audit-1',
    };
    const { service, chains } = setup({ data: rejectedRow, error: null });
    const detail = await service.findOne(user, 'r1');

    expect(chains.report.update).toHaveBeenCalledWith({
      rejected_by: 'staff-audit-1',
    });
    expect(detail.rejectedBy).toBe('staff-audit-1');
  });

  it('reconciles missing verified_by when status is <> Menunggu Verifikasi && <> Ditolak and updated_by is present', async () => {
    const verifiedRow = {
      ...row,
      status: { status_name: 'Dalam Perbaikan' },
      verified_by: null,
      updated_by: 'staff-audit-2',
    };
    const { service, chains } = setup({ data: verifiedRow, error: null });
    const detail = await service.findOne(user, 'r1');

    expect(chains.report.update).toHaveBeenCalledWith({
      verified_by: 'staff-audit-2',
    });
    expect(detail.verifiedBy).toBe('staff-audit-2');
  });
});

describe('ReportDetailService.updateStatus', () => {
  const user = { id: 'staff-99', role: 'staff' };

  it('sets rejected_by to user.id when changing status to Ditolak', async () => {
    const { service, chains } = setup({
      data: {
        ...row,
        status: { status_name: 'Ditolak' },
        rejected_by: 'staff-99',
      },
      error: null,
    });
    await service.updateStatus(user as any, 'r1', { statusName: 'Ditolak' });

    expect(chains.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        rejected_by: 'staff-99',
        updated_by: 'staff-99',
      }),
    );
  });

  it('sets verified_by to user.id when changing status to Dalam Pemeriksaan', async () => {
    const { service, chains } = setup({
      data: {
        ...row,
        status: { status_name: 'Dalam Pemeriksaan' },
        verified_by: 'staff-99',
      },
      error: null,
    });
    await service.updateStatus(user as any, 'r1', {
      statusName: 'Dalam Pemeriksaan',
    });

    expect(chains.report.update).toHaveBeenCalledWith(
      expect.objectContaining({
        verified_by: 'staff-99',
        updated_by: 'staff-99',
      }),
    );
  });
});
