export type HostAction = (
  path: string,
  body?: unknown,
  method?: "POST" | "PATCH" | "DELETE",
) => Promise<boolean>;
