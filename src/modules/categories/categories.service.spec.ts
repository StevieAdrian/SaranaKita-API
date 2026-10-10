import type { SupabaseService } from '../../supabase/supabase.service';
import { CategoriesService } from './categories.service';

jest.mock('../../supabase/supabase.service', () => ({
  SupabaseService: class {},
}));

function mockSupabase(result: { data: unknown; error: unknown }) {
  const order = jest.fn().mockResolvedValue(result);
  const select = jest.fn().mockReturnValue({ order });
  const from = jest.fn().mockReturnValue({ select });
  const service = {
    getAdminClient: () => ({ from }),
  } as unknown as SupabaseService;
  return { service, from, select, order };
}

describe('CategoriesService', () => {
  it('maps rows to { id, name } ordered by name', async () => {
    const { service, from, select, order } = mockSupabase({
      data: [
        { id: 'a', category_name: 'Elektronik' },
        { id: 'b', category_name: 'Furnitur' },
      ],
      error: null,
    });

    const result = await new CategoriesService(service).findAll();

    expect(from).toHaveBeenCalledWith('category');
    expect(select).toHaveBeenCalledWith('id, category_name');
    expect(order).toHaveBeenCalledWith('category_name', { ascending: true });
    expect(result).toEqual([
      { id: 'a', name: 'Elektronik' },
      { id: 'b', name: 'Furnitur' },
    ]);
  });

  it('returns an empty list when there is no data', async () => {
    const { service } = mockSupabase({ data: null, error: null });
    await expect(new CategoriesService(service).findAll()).resolves.toEqual([]);
  });

  it('throws when Supabase returns an error', async () => {
    const error = new Error('db down');
    const { service } = mockSupabase({ data: null, error });
    await expect(new CategoriesService(service).findAll()).rejects.toBe(error);
  });
});
