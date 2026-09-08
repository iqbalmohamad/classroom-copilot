export type HostAction = (
  path: string,
  body?: unknown,
  method?: "POST" | "DELETE",
) => Promise<boolean>;
