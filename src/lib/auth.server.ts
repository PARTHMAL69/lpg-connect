import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";

let _admin: SupabaseClient<Database> | undefined;
let _public: SupabaseClient<Database> | undefined;

export function getAdminClient(): SupabaseClient<Database> {
  if (_admin) return _admin;
  const url = process.env.SUPABASE_URL || (import.meta.env && import.meta.env.SUPABASE_URL);
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || (import.meta.env && import.meta.env.SUPABASE_SERVICE_ROLE_KEY);
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  _admin = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _admin;
}

export function getPublicServerClient(): SupabaseClient<Database> {
  if (_public) return _public;
  const url = process.env.SUPABASE_URL || (import.meta.env && import.meta.env.SUPABASE_URL);
  const key = process.env.SUPABASE_PUBLISHABLE_KEY || (import.meta.env && import.meta.env.SUPABASE_PUBLISHABLE_KEY);
  if (!url || !key) throw new Error("Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY");
  _public = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return _public;
}

export const AGENCY_DOMAIN = "lpg.internal";
export function agencyAuthEmail(agencyCode: string, username: string) {
  return `agency-${agencyCode.toLowerCase()}-${username.toLowerCase()}@${AGENCY_DOMAIN}`;
}
export function platformAuthEmail(username: string) {
  return `platform-${username.toLowerCase()}@${AGENCY_DOMAIN}`;
}
