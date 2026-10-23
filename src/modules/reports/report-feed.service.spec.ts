import { NotFoundException } from '@nestjs/common';
import type { SupabaseService } from '../../supabase/supabase.service';
import type { SchoolMembershipService } from '../schools/school-membership.service';
import {
  toFeedReport,
  toReportStatus,
  toSearchTerm,
  type FeedReportRow,
} from './report-feed.mapper';
import { ReportFeedService } from './report-feed.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class { },
}));
jest.mock('../schools/school-membership.service', () => ({
  SchoolMembershipService: class { },
}));

type Result = { data?: unknown; error?: unknown; count?: number | null };

function chain(result: Result) {
  const c: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'or',
    'order',
    'range',
    'limit',
    'insert',
    'delete',
  ]) {
    c[method] = jest.fn(() => c);
  }
  c.maybeSingle = jest.fn().mockResolvedValue(result);
  c.then = (resolve: (value: Result) => unknown) =>
    Promise.resolve(result).then(resolve);
  return c;
}

const USER = { id: 'user-1', role: 'siswa' as const };

const row: FeedReportRow = {
  id: 'r1',
  reporter_id: 'user-1',
  title: 'Proyektor',
  description: null,
  location: 'XII B',
  category_id: 'c1',
  image_url: null,
  created_at: '2026-07-24T00:00:00Z',
  status: { status_name: 'Dalam Perbaikan' },
  reporter: {
    username: 'alicia',
    profile: [{ full_name: 'Alicia Felisha', class: 'XII B' }],
  },
  reports_votes: [{ count: 3 }],
  reports_comments: [{ count: 1 }],
  recommendations: [{ count: 0 }],
  verified_by: null,
  rejected_by: null,
  updated_by: null,
  reports_notes: [],
};

function setup(tables: Record<string, Result[]>) {
  const queues = Object.fromEntries(
    Object.entries(tables).map(([t, results]) => [t, results.map(chain)]),
  );
  const used: Record<string, ReturnType<typeof chain>[]> = {};
  const from = jest.fn((table: string) => {
    const next = queues[table]?.shift() ?? chain({ data: null, error: null });
    (used[table] ??= []).push(next);
    return next;
  });
  const supabase = {
    getAdminClient: () => ({ from }),
  } as unknown as SupabaseService;
  const membership = {
    getSchoolId: jest.fn().mockResolvedValue('school-1'),
  } as unknown as SchoolMembershipService;
  return { service: new ReportFeedService(supabase, membership), used };
}

describe('report feed mapper', () => {
  it.each([
    [null, 'waiting_verification'],
    ['Menunggu Verifikasi', 'waiting_verification'],
    ['dalam pemeriksaan', 'in_review'],
    [' Dalam Perbaikan ', 'in_repair'],
    ['Ditolak', 'rejected'],
    ['SELESAI', 'done'],
    ['in_repair', 'in_repair'],
  ])('maps status %p to %p', (input, expected) => {
    expect(toReportStatus(input)).toBe(expected);
  });

  it('maps a row with nested relations', () => {
    expect(toFeedReport(row, true)).toEqual({
      id: 'r1',
      reporter_id: 'user-1',
      title: 'Proyektor',
      description: '',
      location: 'XII B',
      categoryId: 'c1',
      status: 'in_repair',
      imageUrl: null,
      reporterName: 'Alicia Felisha',
      reporterClass: 'XII B',
      createdAt: '2026-07-24T00:00:00Z',
      votes: 3,
      comments: 1,
      recommendations: 0,
      votedByMe: true,
      recommendedByMe: false,
      verifiedBy: null,
      rejectedBy: null,
      updatedBy: null,
      note: null,
    });
  });

  it('falls back to username when the profile is missing', () => {
    const mapped = toFeedReport(
      { ...row, reporter: { username: 'stevie', profile: null } },
      false,
    );
    expect(mapped).toMatchObject({
      reporterName: 'stevie',
      reporterClass: null,
    });
  });

  it.each([
    [undefined, null],
    ['   ', null],
    ['proyektor', 'proyektor'],
    ['a,b).or(x', 'a b or x'],
    ['%_*"\\', null],
    ['kelas X-B', 'kelas X-B'],
  ])('sanitises search %p', (input, expected) => {
    expect(toSearchTerm(input)).toBe(expected);
  });
});

describe('ReportFeedService.list', () => {
  it('scopes to the user school and marks own votes', async () => {
    const { service, used } = setup({
      report: [{ data: [row, { ...row, id: 'r2' }], error: null, count: 2 }],
      reports_votes: [{ data: [{ report_id: 'r2' }], error: null }],
    });

    const result = await service.list(USER, {
      page: 1,
      limit: 20,
      sort: 'latest',
    });

    expect(used.report[0].eq).toHaveBeenCalledWith('school_id', 'school-1');
    expect(used.report[0].range).toHaveBeenCalledWith(0, 19);
    expect(used.reports_votes[0].eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(result.items.map((i) => [i.id, i.votedByMe])).toEqual([
      ['r1', false],
      ['r2', true],
    ]);
    expect(result).toMatchObject({ total: 2, totalPages: 1 });
  });

  it('applies category and sanitised search filters', async () => {
    const { service, used } = setup({
      report: [{ data: [], error: null, count: 0 }],
    });

    await service.list(USER, {
      page: 2,
      limit: 10,
      sort: 'latest',
      categoryId: 'c1',
      search: 'atap),x',
    });

    expect(used.report[0].eq).toHaveBeenCalledWith('category_id', 'c1');
    expect(used.report[0].or).toHaveBeenCalledWith(
      'title.ilike.%atap x%,description.ilike.%atap x%,location.ilike.%atap x%',
    );
    expect(used.report[0].range).toHaveBeenCalledWith(10, 19);
  });

  it('filters status by ids and treats null as waiting_verification', async () => {
    const { service, used } = setup({
      status: [
        {
          data: [
            { id: 's-done', status_name: 'Selesai' },
            { id: 's-wait', status_name: 'Menunggu Verifikasi' },
            { id: 's-fix', status_name: 'Dalam Perbaikan' },
          ],
          error: null,
        },
      ],
      report: [{ data: [], error: null, count: 0 }],
    });

    await service.list(USER, {
      page: 1,
      limit: 20,
      sort: 'latest',
      status: ['waiting_verification', 'done'],
    });

    expect(used.report[0].or).toHaveBeenCalledWith(
      'status_id.in.(s-done,s-wait),status_id.is.null',
    );
  });

  it('returns an empty page when no status row matches', async () => {
    const { service, used } = setup({
      status: [{ data: [], error: null }],
      report: [{ data: [row], error: null, count: 1 }],
    });

    const result = await service.list(USER, {
      page: 1,
      limit: 20,
      sort: 'latest',
      status: ['done'],
    });

    expect(result).toEqual({
      items: [],
      total: 0,
      page: 1,
      limit: 20,
      totalPages: 0,
    });
    expect(used.report[0].range).not.toHaveBeenCalled();
  });

  it('orders oldest first in the database', async () => {
    const { service, used } = setup({
      report: [{ data: [], error: null, count: 0 }],
    });
    await service.list(USER, { page: 1, limit: 20, sort: 'oldest' });
    expect(used.report[0].order).toHaveBeenCalledWith('created_at', {
      ascending: true,
    });
  });

  it.each([
    ['most_votes', ['b', 'd', 'a']],
    ['least_votes', ['c', 'a', 'd']],
    ['most_recommendations', ['d', 'a', 'b']],
  ] as const)('sorts %s in memory and paginates', async (sort, expected) => {
    const rows = [
      {
        ...row,
        id: 'a',
        reports_votes: [{ count: 2 }],
        recommendations: [{ count: 3 }],
      },
      {
        ...row,
        id: 'b',
        reports_votes: [{ count: 9 }],
        recommendations: [{ count: 0 }],
      },
      {
        ...row,
        id: 'c',
        reports_votes: [{ count: 0 }],
        recommendations: [{ count: 0 }],
      },
      {
        ...row,
        id: 'd',
        reports_votes: [{ count: 5 }],
        recommendations: [{ count: 7 }],
      },
    ];
    const { service, used } = setup({
      report: [{ data: rows, error: null, count: 4 }],
      reports_votes: [{ data: [], error: null }],
    });

    const result = await service.list(USER, { page: 1, limit: 3, sort });

    expect(used.report[0].limit).toHaveBeenCalledWith(500);
    expect(result.items.map((r) => r.id)).toEqual(expected);
    expect(result).toMatchObject({ total: 4, totalPages: 2 });
  });
});

describe('ReportFeedService.popular', () => {
  it('sorts by votes, drops zero-vote reports, and limits', async () => {
    const rows = [
      { ...row, id: 'a', reports_votes: [{ count: 2 }] },
      { ...row, id: 'b', reports_votes: [{ count: 9 }] },
      { ...row, id: 'c', reports_votes: [{ count: 0 }] },
      { ...row, id: 'd', reports_votes: [{ count: 5 }] },
    ];
    const { service } = setup({
      report: [{ data: rows, error: null }],
      reports_votes: [{ data: [], error: null }],
    });

    const result = await service.popular(USER, { limit: 2 });
    expect(result.map((r) => r.id)).toEqual(['b', 'd']);
  });
});

describe('ReportFeedService.vote', () => {
  it('rejects reports outside the user school', async () => {
    const { service } = setup({ report: [{ data: null, error: null }] });
    await expect(service.vote(USER, 'r9')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('inserts a vote once and returns the new count', async () => {
    const { service, used } = setup({
      report: [{ data: { id: 'r1' }, error: null }],
      reports_votes: [
        { data: null, error: null },
        { error: null },
        { count: 4, error: null },
        { count: 1, error: null },
      ],
    });

    await expect(service.vote(USER, 'r1')).resolves.toEqual({
      reportId: 'r1',
      votes: 4,
      votedByMe: true,
    });
    expect(used.reports_votes[1].insert).toHaveBeenCalledWith({
      report_id: 'r1',
      user_id: 'user-1',
    });
  });

  it('does not insert a duplicate vote', async () => {
    const { service, used } = setup({
      report: [{ data: { id: 'r1' }, error: null }],
      reports_votes: [
        { data: { id: 'v1' }, error: null },
        { count: 4, error: null },
        { count: 1, error: null },
      ],
    });

    await service.vote(USER, 'r1');
    expect(used.reports_votes.some((c) => c.insert.mock.calls.length)).toBe(
      false,
    );
  });
});

describe('ReportFeedService.unvote', () => {
  it('deletes only the current user vote', async () => {
    const { service, used } = setup({
      report: [{ data: { id: 'r1' }, error: null }],
      reports_votes: [
        { error: null },
        { count: 3, error: null },
        { count: 0, error: null },
      ],
    });

    await expect(service.unvote(USER, 'r1')).resolves.toEqual({
      reportId: 'r1',
      votes: 3,
      votedByMe: false,
    });
    expect(used.reports_votes[0].delete).toHaveBeenCalled();
    expect(used.reports_votes[0].eq).toHaveBeenCalledWith('user_id', 'user-1');
  });
});
