import type { SupabaseService } from '../../supabase/supabase.service';
import type { SchoolMembershipService } from '../schools/school-membership.service';
import { ReportDashboardService } from './report-dashboard.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));

type Filter = { method: string; args: unknown[] };

function query(
  resultFor: (filters: Filter[], selection: unknown[]) => unknown,
) {
  const filters: Filter[] = [];
  let selection: unknown[] = [];
  const builder: Record<string, jest.Mock> & { then?: unknown } = {};
  for (const method of [
    'select',
    'eq',
    'in',
    'is',
    'gte',
    'or',
    'order',
    'limit',
  ]) {
    builder[method] = jest.fn((...args: unknown[]) => {
      if (method === 'select') selection = args;
      else filters.push({ method, args });
      return builder;
    });
  }
  builder.maybeSingle = jest.fn().mockResolvedValue({
    data: { school_name: 'SMAN 78 Jakarta' },
    error: null,
  });
  builder.then = (resolve: (value: unknown) => unknown) =>
    Promise.resolve(resultFor(filters, selection)).then(resolve);
  return builder;
}

const waitingReport = {
  id: 'report-1',
  title: 'Atap Kelas Bocor',
  description: 'Bocor saat hujan',
  location: 'X A',
  category_id: 'category-1',
  image_url: null,
  created_at: '2026-10-10T00:00:00.000Z',
  status: { status_name: 'Menunggu Verifikasi' },
  reporter: { username: 'siswa', profile: null },
  reports_votes: [{ count: 4 }],
  reports_comments: [{ count: 2 }],
  recommendations: [{ count: 0 }],
};

describe('ReportDashboardService.getDashboard', () => {
  it('returns exact report counts, category totals, and recent unverified reports', async () => {
    const client = {
      from: jest.fn((table: string) =>
        query((filters, selection) => {
          if (table === 'status') {
            return {
              data: [
                { id: 'waiting-id', status_name: 'Menunggu Verifikasi' },
                { id: 'review-id', status_name: 'Dalam Pemeriksaan' },
              ],
              error: null,
            };
          }
          if (table === 'category') {
            return {
              data: [{ id: 'category-1', category_name: 'Fasilitas' }],
              error: null,
            };
          }
          if (table === 'school') {
            return { data: { school_name: 'SMAN 78 Jakarta' }, error: null };
          }
          if (table === 'report' && selection[1]) {
            const countFilter = filters.find(({ method }) =>
              ['in', 'is', 'eq', 'gte'].includes(method),
            );
            const count =
              countFilter?.method === 'in' &&
              countFilter.args[0] === 'status_id' &&
              (countFilter.args[1] as string[]).includes('waiting-id')
                ? 3
                : countFilter?.method === 'in'
                  ? 4
                  : countFilter?.method === 'is'
                    ? 1
                    : countFilter?.method === 'eq'
                      ? 6
                      : countFilter?.method === 'gte'
                        ? 2
                        : 10;
            return { data: null, count, error: null };
          }
          return { data: [waitingReport], error: null };
        }),
      ),
    };
    const supabase = {
      getAdminClient: () => client,
    } as unknown as SupabaseService;
    const schoolMembership = {
      getSchool: jest.fn(),
    } as unknown as SchoolMembershipService;
    const service = new ReportDashboardService(supabase, schoolMembership);

    const dashboard = await service.getDashboard({
      id: 'admin-1',
      role: 'administrator',
    });

    expect(dashboard.schoolName).toBe('SMAN 78 Jakarta');
    expect(dashboard.totalReports).toBe(10);
    expect(dashboard.totalThisMonth).toBe(2);
    expect(dashboard.statusCounts).toMatchObject({
      waiting_verification: 4,
      in_review: 4,
      in_repair: 0,
      rejected: 0,
      done: 0,
    });
    expect(dashboard.categories).toEqual([
      { id: 'category-1', name: 'Fasilitas', count: 6 },
    ]);
    expect(dashboard.urgentReports).toHaveLength(1);
    expect(dashboard.urgentReports[0]).toMatchObject({
      title: 'Atap Kelas Bocor',
      status: 'waiting_verification',
      votes: 4,
      comments: 2,
    });
  });
});
