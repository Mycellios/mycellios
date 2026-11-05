import { MARKETING_BRAND_PATHS as paths } from "../../../src/contracts/marketing-navigation";

/** Shared brand marks are decorative; the enclosing link supplies its name. */
export function BrandIcon({ name }: { name: keyof typeof paths }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>;
}
