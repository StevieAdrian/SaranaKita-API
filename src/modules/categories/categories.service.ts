import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import type { CategoryResponse, CategoryRow } from './categories.types';

@Injectable()
export class CategoriesService {
  private readonly table = 'category';

  constructor(private readonly supabaseService: SupabaseService) {}

  async findAll(): Promise<CategoryResponse[]> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from(this.table)
      .select('id, category_name')
      .order('category_name', { ascending: true });

    if (error) {
      throw error;
    }

    return ((data as CategoryRow[] | null) ?? []).map((row) => ({
      id: row.id,
      name: row.category_name,
    }));
  }
}
