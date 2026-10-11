export const USER_ROLES = ['siswa', 'guru', 'staff', 'administrator'] as const;

export type UserRole = (typeof USER_ROLES)[number];

export function isUserRole(value: unknown): value is UserRole {
  return (
    typeof value === 'string' &&
    (USER_ROLES as readonly string[]).includes(value)
  );
}

export function toUserRole(value: unknown): UserRole | null {
  if (typeof value !== 'string') {
    return null;
  }
  const normalised = value.trim().toLowerCase();
  return isUserRole(normalised) ? normalised : null;
}
