/**
 * Simple class name utility for conditional Tailwind classes
 */
export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes
    .filter((cls) => typeof cls === 'string' && cls.length > 0)
    .join(' ');
}
