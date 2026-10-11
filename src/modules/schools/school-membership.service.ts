import { ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../supabase/supabase.service';

const MEMBERSHIP_TABLES = ['siswa', 'guru', 'staff'] as const;

export type UserSchool = {
  id: string;
  name: string | null;
};

type MembershipRow = {
  school_id?: string | null;
  school?:
    { school_name?: string | null } | { school_name?: string | null }[] | null;
};

@Injectable()
export class SchoolMembershipService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getSchool(userId: string): Promise<UserSchool> {
    const client = this.supabaseService.getAdminClient();
    const results = await Promise.all(
      MEMBERSHIP_TABLES.map((table) =>
        client
          .from(table)
          .select('school_id, school(school_name)')
          .eq('user_id', userId)
          .limit(1)
          .maybeSingle(),
      ),
    );

    for (const { data, error } of results) {
      if (error) {
        throw error;
      }
      const row = data as MembershipRow | null;
      if (row?.school_id) {
        const school = Array.isArray(row.school) ? row.school[0] : row.school;
        return { id: row.school_id, name: school?.school_name ?? null };
      }
    }

    throw new ForbiddenException(
      'Akun kamu belum terhubung ke sekolah mana pun.',
    );
  }

  async getSchoolId(userId: string): Promise<string> {
    return (await this.getSchool(userId)).id;
  }
}
