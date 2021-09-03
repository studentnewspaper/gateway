import IdHasher from "hashids";

export const hashAuthor = new IdHasher("author", 10);
export const hashArticle = new IdHasher("article", 10);

export function textOrNull(s: string | null | undefined): string | null {
  if (s == null) return null;
  let x = s.trim();
  return x.length > 0 ? x : null;
}

export function isTruthy<T>(x: T | null | undefined): x is T {
  return x != null;
}
