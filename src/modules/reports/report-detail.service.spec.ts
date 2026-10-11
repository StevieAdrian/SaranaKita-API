import { NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SchoolMembershipService } from '../schools/school-membership.service';
import { toReportDetail, type ReportDetailRow } from './report-detail.mapper';
import { ReportDetailService } from './report-detail.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));
jest.mock('../schools/school-membership.service', () => ({
  SchoolMembershipService: class {},
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
      timeline: [
        { type: 'in_repair', at: '2026-07-25T01:00:00Z' },
        { type: 'created', at: '2026-07-24T01:00:00Z' },
      ],
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
});

function chain(result: { data?: unknown; error?: unknown; count?: number }) {
  const c: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of ['select', 'eq']) {
    c[method] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  c.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

function setup(report: { data: unknown; error: unknown }, voteCount = 0) {
  const chains = {
    report: chain(report),
    reports_votes: chain({ count: voteCount, error: null }),
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
  });

  it('throws NotFound for reports in other schools', async () => {
    const { service } = setup({ data: null, error: null });
    await expect(service.findOne(user, 'r9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
