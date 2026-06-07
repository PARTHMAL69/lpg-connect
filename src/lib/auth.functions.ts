import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  getAdminClient,
  getPublicServerClient,
  agencyAuthEmail,
  platformAuthEmail,
} from "./auth.server";

const DEFAULT_PRODUCTS: { name: string; rate: number; requires_delivery_boy: boolean }[] = [
  { name: "14 KG CNC", rate: 0, requires_delivery_boy: false },
  { name: "14 KG Home Delivery", rate: 0, requires_delivery_boy: true },
  { name: "19 KG", rate: 0, requires_delivery_boy: false },
  { name: "10 KG", rate: 0, requires_delivery_boy: false },
  { name: "5 KG", rate: 0, requires_delivery_boy: false },
  { name: "2 KG", rate: 0, requires_delivery_boy: false },
  { name: "FTL", rate: 0, requires_delivery_boy: false },
  { name: "Nano-cut", rate: 0, requires_delivery_boy: false },
  { name: "Tube", rate: 0, requires_delivery_boy: false },
  { name: "Regulator", rate: 0, requires_delivery_boy: false },
  { name: "Lighter", rate: 0, requires_delivery_boy: false },
  { name: "Flame Lighter", rate: 0, requires_delivery_boy: false },
  { name: "Burner", rate: 0, requires_delivery_boy: false },
];

/** Returns { exists } — used to decide whether to show bootstrap UI. */
export const platformAdminExists = createServerFn({ method: "GET" }).handler(async () => {
  const admin = getAdminClient();
  const { count, error } = await admin
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .eq("role", "platform_admin");
  if (error) throw new Error(error.message);
  return { exists: (count ?? 0) > 0 };
});

/** First-time platform admin creation. Fails if any platform admin already exists. */
export const bootstrapPlatformAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
        password: z.string().min(8).max(72),
        fullName: z.string().trim().min(1).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { count } = await admin
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "platform_admin");
    if ((count ?? 0) > 0) throw new Error("Platform admin already exists");

    const email = platformAuthEmail(data.username);
    const { data: created, error: cErr } = await admin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: { username: data.username, full_name: data.fullName, kind: "platform_admin" },
    });
    if (cErr || !created.user) throw new Error(cErr?.message ?? "Failed to create user");

    const userId = created.user.id;
    const { error: auErr } = await admin.from("agency_users").insert({
      user_id: userId,
      agency_id: null,
      username: data.username,
      full_name: data.fullName,
      is_platform_admin: true,
    });
    if (auErr) throw new Error(auErr.message);

    const { error: rErr } = await admin
      .from("user_roles")
      .insert({ user_id: userId, role: "platform_admin", agency_id: null });
    if (rErr) throw new Error(rErr.message);

    // Sign in to return a session
    const pub = getPublicServerClient();
    const { data: session, error: sErr } = await pub.auth.signInWithPassword({
      email,
      password: data.password,
    });
    if (sErr || !session.session) throw new Error("Created but could not sign in");
    return { access_token: session.session.access_token, refresh_token: session.session.refresh_token };
  });

export const loginPlatformAdmin = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z.object({ username: z.string().trim().min(1).max(50), password: z.string().min(1).max(72) }).parse(d),
  )
  .handler(async ({ data }) => {
    const pub = getPublicServerClient();
    const email = platformAuthEmail(data.username);
    const { data: session, error } = await pub.auth.signInWithPassword({ email, password: data.password });
    if (error || !session.session) throw new Error("Invalid credentials");

    // Verify role
    const admin = getAdminClient();
    const { data: roles } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", session.user!.id)
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roles) {
      await pub.auth.signOut();
      throw new Error("Not a platform admin");
    }
    return { access_token: session.session.access_token, refresh_token: session.session.refresh_token };
  });

export const loginAgency = createServerFn({ method: "POST" })
  .inputValidator((d: unknown) =>
    z
      .object({
        agencyCode: z.string().trim().min(1).max(50),
        username: z.string().trim().min(1).max(50),
        password: z.string().min(1).max(72),
      })
      .parse(d),
  )
  .handler(async ({ data }) => {
    const admin = getAdminClient();
    const { data: agency } = await admin
      .from("agencies")
      .select("id, status")
      .ilike("code", data.agencyCode)
      .maybeSingle();
    if (!agency) throw new Error("Invalid credentials");
    if (agency.status !== "active") throw new Error("Agency is disabled");

    const email = agencyAuthEmail(data.agencyCode, data.username);
    const pub = getPublicServerClient();
    const { data: session, error } = await pub.auth.signInWithPassword({ email, password: data.password });
    if (error || !session.session) throw new Error("Invalid credentials");

    // Verify user belongs to that agency and is active
    const { data: au } = await admin
      .from("agency_users")
      .select("agency_id, is_active")
      .eq("user_id", session.user!.id)
      .maybeSingle();
    if (!au || au.agency_id !== agency.id || !au.is_active) {
      await pub.auth.signOut();
      throw new Error("Invalid credentials");
    }
    return { access_token: session.session.access_token, refresh_token: session.session.refresh_token };
  });

/** Platform admin: create agency + admin user + default products. */
export const createAgency = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(1).max(200),
        code: z.string().trim().min(2).max(50).regex(/^[a-zA-Z0-9_-]+$/),
        phone: z.string().trim().max(20).optional().or(z.literal("")),
        address: z.string().trim().max(500).optional().or(z.literal("")),
        defaultLanguage: z.enum(["en", "hi", "mr"]).default("en"),
        adminUsername: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
        adminPassword: z.string().min(8).max(72),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    // Ensure caller is platform admin
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roles) throw new Error("Forbidden");

    const admin = getAdminClient();

    // 1. Create agency
    const { data: agency, error: aErr } = await admin
      .from("agencies")
      .insert({
        name: data.name,
        code: data.code,
        phone: data.phone || null,
        address: data.address || null,
        default_language: data.defaultLanguage,
        created_by: context.userId,
        updated_by: context.userId,
      })
      .select("*")
      .single();
    if (aErr || !agency) throw new Error(aErr?.message ?? "Failed to create agency");

    // 2. Create admin user
    const email = agencyAuthEmail(data.code, data.adminUsername);
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: data.adminPassword,
      email_confirm: true,
      user_metadata: {
        username: data.adminUsername,
        agency_code: data.code,
        agency_id: agency.id,
        kind: "agency_admin",
      },
    });
    if (uErr || !created.user) {
      await admin.from("agencies").delete().eq("id", agency.id);
      throw new Error(uErr?.message ?? "Failed to create admin user");
    }

    await admin.from("agency_users").insert({
      user_id: created.user.id,
      agency_id: agency.id,
      username: data.adminUsername,
      full_name: data.adminUsername,
      is_active: true,
      is_platform_admin: false,
    });
    await admin
      .from("user_roles")
      .insert({ user_id: created.user.id, role: "agency_admin", agency_id: agency.id });

    // 3. Seed default products
    await admin.from("products").insert(
      DEFAULT_PRODUCTS.map((p) => ({
        agency_id: agency.id,
        name: p.name,
        rate: p.rate,
        requires_delivery_boy: p.requires_delivery_boy,
        created_by: context.userId,
        updated_by: context.userId,
      })),
    );

    return { agency };
  });

export const listAgencies = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roles) throw new Error("Forbidden");
    const admin = getAdminClient();
    const { data, error } = await admin
      .from("agencies")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    return { agencies: data ?? [] };
  });

export const setAgencyStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ agencyId: z.string().uuid(), status: z.enum(["active", "disabled"]) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roles) throw new Error("Forbidden");
    const admin = getAdminClient();
    const { error } = await admin
      .from("agencies")
      .update({
        status: data.status,
        disabled_at: data.status === "disabled" ? new Date().toISOString() : null,
        updated_by: context.userId,
      })
      .eq("id", data.agencyId);
    if (error) throw new Error(error.message);
    return { ok: true };
  });

export const resetAgencyAdminPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ agencyId: z.string().uuid(), newPassword: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: roles } = await context.supabase
      .from("user_roles")
      .select("role")
      .eq("role", "platform_admin")
      .maybeSingle();
    if (!roles) throw new Error("Forbidden");

    const admin = getAdminClient();
    // Find first admin user of that agency
    const { data: au } = await admin
      .from("agency_users")
      .select("user_id")
      .eq("agency_id", data.agencyId)
      .limit(1)
      .maybeSingle();
    if (!au) throw new Error("No admin user found for agency");
    const { error } = await admin.auth.admin.updateUserById(au.user_id, { password: data.newPassword });
    if (error) throw new Error(error.message);
    return { ok: true };
  });

/** Returns role/agency info for the current signed-in user. */
export const getMe = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = getAdminClient();
    const [{ data: au }, { data: roles }] = await Promise.all([
      admin
        .from("agency_users")
        .select("id, agency_id, username, full_name, is_active, is_platform_admin")
        .eq("user_id", context.userId)
        .maybeSingle(),
      admin.from("user_roles").select("role, agency_id").eq("user_id", context.userId),
    ]);
    let agency = null as null | { id: string; name: string; code: string; default_language: string; logo_url: string | null };
    if (au?.agency_id) {
      // Try fetching with logo_url
      const { data: ag, error: agErr } = await admin
        .from("agencies")
        .select("id, name, code, default_language, logo_url")
        .eq("id", au.agency_id)
        .maybeSingle();
      if (agErr) {
        console.warn("Failed to fetch agencies with logo_url. Retrying with basic columns only...", agErr.message);
        // Fall back to basic columns only (logo_url might be missing)
        const { data: agBasic } = await admin
          .from("agencies")
          .select("id, name, code, default_language")
          .eq("id", au.agency_id)
          .maybeSingle();
        agency = agBasic ? { ...agBasic, logo_url: null } : null;
      } else {
        agency = ag ?? null;
      }
    }
    return { user: au, roles: roles ?? [], agency };
  });

/** Updates user's personal profile settings (username & full name) and handles Auth synchronization. */
export const updateUserProfile = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
        fullName: z.string().trim().min(1).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    
    // 1. Fetch current caller agency_user details
    const { data: au } = await admin
      .from("agency_users")
      .select("id, agency_id, username, full_name")
      .eq("user_id", context.userId)
      .maybeSingle();
      
    if (!au) throw new Error("Unauthorized");
    
    // 2. Fetch agency info to get code
    let agencyCode = "";
    if (au.agency_id) {
      const { data: ag } = await admin
        .from("agencies")
        .select("code")
        .eq("id", au.agency_id)
        .maybeSingle();
      if (ag) {
        agencyCode = ag.code;
      }
    }

    const usernameChanged = au.username.toLowerCase() !== data.username.toLowerCase();
    
    if (usernameChanged && au.agency_id) {
      // Check if username is already taken by another user in the same agency
      const { data: existing } = await admin
        .from("agency_users")
        .select("id")
        .eq("agency_id", au.agency_id)
        .eq("username", data.username)
        .maybeSingle();
      if (existing) {
        throw new Error("This username is already taken. Please choose a different one.");
      }
      
      // Update Auth email if they belong to an agency
      if (agencyCode) {
        const newEmail = agencyAuthEmail(agencyCode, data.username);
        const { error: authErr } = await admin.auth.admin.updateUserById(context.userId, {
          email: newEmail,
          email_confirm: true,
          user_metadata: {
            username: data.username,
            full_name: data.fullName,
          }
        });
        if (authErr) throw new Error(authErr.message);
      }
    } else {
      // Just update metadata
      const { error: authErr } = await admin.auth.admin.updateUserById(context.userId, {
        user_metadata: {
          username: data.username,
          full_name: data.fullName,
        }
      });
      if (authErr) throw new Error(authErr.message);
    }
    
    // 3. Update public.agency_users table
    const { error: updateErr } = await admin
      .from("agency_users")
      .update({
        username: data.username,
        full_name: data.fullName,
        updated_at: new Date().toISOString()
      })
      .eq("user_id", context.userId);
      
    if (updateErr) throw new Error(updateErr.message);
    
    return { ok: true };
  });

/** Updates the agency's logo image string. */
export const updateAgencyLogo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        logoUrl: z.string().nullable(),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    
    // 1. Fetch user's agency_id
    const { data: au } = await admin
      .from("agency_users")
      .select("agency_id")
      .eq("user_id", context.userId)
      .maybeSingle();
      
    if (!au || !au.agency_id) {
      throw new Error("Unauthorized: User has no associated agency.");
    }
    
    // 2. Update agencies table
    const { error: updateErr } = await admin
      .from("agencies")
      .update({
        logo_url: data.logoUrl,
        updated_at: new Date().toISOString()
      })
      .eq("id", au.agency_id);
      
    if (updateErr) throw new Error(updateErr.message);
    
    return { ok: true };
  });

/** Updates the agency's name details. */
export const updateAgencyDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        name: z.string().trim().min(2).max(100),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    
    // 1. Fetch user's agency_id
    const { data: au } = await admin
      .from("agency_users")
      .select("agency_id")
      .eq("user_id", context.userId)
      .maybeSingle();
      
    if (!au || !au.agency_id) {
      throw new Error("Unauthorized: User has no associated agency.");
    }
    
    // 2. Update agencies table
    const { error: updateErr } = await admin
      .from("agencies")
      .update({
        name: data.name,
        updated_at: new Date().toISOString()
      })
      .eq("id", au.agency_id);
      
    if (updateErr) throw new Error(updateErr.message);
    
    return { ok: true };
  });


export const listAgencyUsers = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const admin = getAdminClient();
    // 1. Get caller info
    const { data: caller } = await admin
      .from("agency_users")
      .select("agency_id, user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!caller || !caller.agency_id) throw new Error("Unauthorized");

    // 2. Verify caller is agency_admin
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!role) throw new Error("Forbidden: Only agency admins can manage users");

    // 3. Fetch users
    const { data: users, error } = await admin
      .from("agency_users")
      .select("id, user_id, username, full_name, is_active, created_at")
      .eq("agency_id", caller.agency_id)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // 4. Fetch roles for all these users
    const { data: userRoles, error: rErr } = await admin
      .from("user_roles")
      .select("user_id, role")
      .eq("agency_id", caller.agency_id);
    if (rErr) throw new Error(rErr.message);

    const rolesMap = Object.fromEntries((userRoles ?? []).map((r) => [r.user_id, r.role]));

    return {
      users: (users ?? []).map((u) => ({
        ...u,
        role: rolesMap[u.user_id] ?? "agency_operator",
      })),
    };
  });

export const createAgencyUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        username: z.string().trim().min(3).max(50).regex(/^[a-zA-Z0-9_.-]+$/),
        password: z.string().min(8).max(72),
        fullName: z.string().trim().min(1).max(100),
        role: z.enum(["agency_admin", "agency_operator"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    // 1. Get caller info
    const { data: caller } = await admin
      .from("agency_users")
      .select("agency_id, user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!caller || !caller.agency_id) throw new Error("Unauthorized");

    // 2. Verify caller is agency_admin
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!role) throw new Error("Forbidden: Only agency admins can manage users");

    // Get agency code
    const { data: agency } = await admin
      .from("agencies")
      .select("code")
      .eq("id", caller.agency_id)
      .single();
    if (!agency) throw new Error("Agency not found");

    // 3. Create user in auth
    const email = agencyAuthEmail(agency.code, data.username);
    const { data: created, error: uErr } = await admin.auth.admin.createUser({
      email,
      password: data.password,
      email_confirm: true,
      user_metadata: {
        username: data.username,
        agency_code: agency.code,
        agency_id: caller.agency_id,
        kind: data.role,
      },
    });
    if (uErr || !created.user) throw new Error(uErr?.message ?? "Failed to create user");

    // 4. Create in agency_users and user_roles
    const { error: auErr } = await admin.from("agency_users").insert({
      user_id: created.user.id,
      agency_id: caller.agency_id,
      username: data.username,
      full_name: data.fullName,
      is_active: true,
      is_platform_admin: false,
    });
    if (auErr) {
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(auErr.message);
    }

    const { error: rErr } = await admin.from("user_roles").insert({
      user_id: created.user.id,
      role: data.role,
      agency_id: caller.agency_id,
    });
    if (rErr) {
      await admin.from("agency_users").delete().eq("user_id", created.user.id);
      await admin.auth.admin.deleteUser(created.user.id);
      throw new Error(rErr.message);
    }

    return { ok: true };
  });

export const updateAgencyUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z
      .object({
        userId: z.string().uuid(),
        fullName: z.string().trim().min(1).max(100),
        role: z.enum(["agency_admin", "agency_operator"]),
      })
      .parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    // 1. Get caller info
    const { data: caller } = await admin
      .from("agency_users")
      .select("agency_id, user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!caller || !caller.agency_id) throw new Error("Unauthorized");

    // 2. Verify caller is agency_admin
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    // Verify target user is in the same agency
    const { data: target } = await admin
      .from("agency_users")
      .select("id")
      .eq("user_id", data.userId)
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!target) throw new Error("User not found in your agency");

    // 3. Update full name
    const { error: auErr } = await admin
      .from("agency_users")
      .update({ full_name: data.fullName })
      .eq("user_id", data.userId);
    if (auErr) throw new Error(auErr.message);

    // 4. Update role
    await admin
      .from("user_roles")
      .delete()
      .eq("user_id", data.userId)
      .eq("agency_id", caller.agency_id);

    const { error: rErr } = await admin.from("user_roles").insert({
      user_id: data.userId,
      role: data.role,
      agency_id: caller.agency_id,
    });
    if (rErr) throw new Error(rErr.message);

    return { ok: true };
  });

export const toggleAgencyUserStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), isActive: z.boolean() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    // 1. Get caller info
    const { data: caller } = await admin
      .from("agency_users")
      .select("agency_id, user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!caller || !caller.agency_id) throw new Error("Unauthorized");

    // 2. Verify caller is agency_admin
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    // Verify target user is in the same agency and NOT the caller themselves (cannot disable self)
    if (data.userId === context.userId) throw new Error("Cannot change your own active status");

    const { data: target } = await admin
      .from("agency_users")
      .select("id")
      .eq("user_id", data.userId)
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!target) throw new Error("User not found in your agency");

    // 3. Update status
    const { error } = await admin
      .from("agency_users")
      .update({ is_active: data.isActive })
      .eq("user_id", data.userId);
    if (error) throw new Error(error.message);

    return { ok: true };
  });

export const resetAgencyUserPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) =>
    z.object({ userId: z.string().uuid(), newPassword: z.string().min(8).max(72) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const admin = getAdminClient();
    // 1. Get caller info
    const { data: caller } = await admin
      .from("agency_users")
      .select("agency_id, user_id")
      .eq("user_id", context.userId)
      .maybeSingle();
    if (!caller || !caller.agency_id) throw new Error("Unauthorized");

    // 2. Verify caller is agency_admin
    const { data: role } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", context.userId)
      .eq("role", "agency_admin")
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!role) throw new Error("Forbidden");

    // Verify target user is in the same agency
    const { data: target } = await admin
      .from("agency_users")
      .select("id")
      .eq("user_id", data.userId)
      .eq("agency_id", caller.agency_id)
      .maybeSingle();
    if (!target) throw new Error("User not found in your agency");

    // 3. Reset password in auth
    const { error } = await admin.auth.admin.updateUserById(data.userId, { password: data.newPassword });
    if (error) throw new Error(error.message);

    return { ok: true };
  });
