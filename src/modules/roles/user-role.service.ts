import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';
import { toUserRole, type UserRole } from '../../common/utils/resolve-role';

type RoleRelation = { role_name?: unknown } | { role_name?: unknown }[] | null;

@Injectable()
export class UserRoleService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getRole(userId: string): Promise<UserRole | null> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('user')
      .select('roles(role_name)')
      .eq('id', userId)
      .maybeSingle();

    if (error) {
      throw error;
    }

    const relation = (data as { roles?: RoleRelation } | null)?.roles ?? null;
    const row = Array.isArray(relation) ? relation[0] : relation;
    return toUserRole(row?.role_name);
  }

  async getRoleId(role: UserRole): Promise<string> {
    const { data, error } = await this.supabaseService
      .getAdminClient()
      .from('roles')
      .select('id')
      .eq('role_name', role)
      .maybeSingle();

    if (error) {
      throw error;
    }
    const id = (data as { id?: string } | null)?.id;
    if (!id) {
      throw new BadRequestException(`Role "${role}" belum ada di tabel roles.`);
    }
    return id;
  }
}
