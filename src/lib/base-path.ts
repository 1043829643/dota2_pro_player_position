const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH || "";

export function appPath(path: string): string {
  if (!BASE_PATH) return path;
  return `${BASE_PATH}${path.startsWith("/") ? path : `/${path}`}`;
}

export function apiPath(path: string): string {
  return appPath(path);
}
