export type VisibleMessage = {
  id?: string;
  message?: string;
};

export function visibleText(rendered: string, descriptor: VisibleMessage): string {
  const source = descriptor.message;
  if (source && descriptor.id && rendered === descriptor.id) return source;
  return rendered;
}
