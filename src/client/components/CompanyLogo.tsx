import type { Company } from '@shared/types';
import { logoColor, monogram } from '@shared/logo';

/** A company's logo address; the update time in it makes a new logo a new address. */
export const logoUrl = (c: Pick<Company, 'id' | 'updated_at'>) =>
  `/api/companies/${c.id}/logo?v=${encodeURIComponent(c.updated_at)}`;

/**
 * The company's mark: its logo when one was uploaded, otherwise a monogram (its first meaningful
 * initial, white on its chosen colour, ultramarine by default). Nothing without a company.
 */
export function CompanyLogo({
  company,
  size = 28,
}: {
  company: Pick<Company, 'id' | 'name' | 'has_logo' | 'logo_color' | 'updated_at'> | undefined;
  size?: number;
}) {
  if (!company) return null;
  if (!company.has_logo)
    return (
      <span
        className="co-logo co-mono"
        aria-hidden="true"
        style={{
          width: size,
          height: size,
          fontSize: Math.round(size * 0.5),
          background: logoColor(company.logo_color).hex,
        }}
      >
        {monogram(company.name)}
      </span>
    );
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
