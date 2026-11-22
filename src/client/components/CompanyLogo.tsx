import type { Company } from '@shared/types';

/** A company's logo address; the update time in it makes a new logo a new address. */
export const logoUrl = (c: Pick<Company, 'id' | 'updated_at'>) =>
  `/api/companies/${c.id}/logo?v=${encodeURIComponent(c.updated_at)}`;

/** The company's logo, small, when one was uploaded; nothing otherwise. */
export function CompanyLogo({
  company,
  size = 28,
}: {
  company: Company | undefined;
  size?: number;
}) {
  if (!company?.has_logo) return null;
  return (
    <img
      className="co-logo"
      src={logoUrl(company)}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
    />
  );
}
