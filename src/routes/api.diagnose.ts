import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/auth.server";

function decodeJwtPayload(token: string) {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return { error: "Invalid JWT format (must have 3 parts)" };
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
    const jsonPayload = Buffer.from(base64, "base64").toString("utf8");
    return JSON.parse(jsonPayload);
  } catch (e: any) {
    return { error: e.message };
  }
}

export const Route = createFileRoute("/api/diagnose")({
  server: {
    handlers: {
      GET: async () => {
        const url = process.env.SUPABASE_URL || "not_found";
        
        const lpgServiceKey = process.env.LPG_SERVICE_ROLE_KEY || "";
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
        const publishableKey = process.env.SUPABASE_PUBLISHABLE_KEY || "";
        
        const keyUsedName = lpgServiceKey 
          ? "LPG_SERVICE_ROLE_KEY" 
          : supabaseServiceKey 
            ? "SUPABASE_SERVICE_ROLE_KEY" 
            : publishableKey 
              ? "SUPABASE_PUBLISHABLE_KEY (FALLBACK)" 
              : "none";
              
        const keyUsed = lpgServiceKey || supabaseServiceKey || publishableKey;
        const decoded = keyUsed ? decodeJwtPayload(keyUsed) : null;
        
        let adminApiSuccess = false;
        let adminApiError = null;
        let userCount = 0;
        
        if (keyUsed && keyUsedName !== "SUPABASE_PUBLISHABLE_KEY (FALLBACK)") {
          try {
            const admin = getAdminClient();
            const { data, error } = await admin.auth.admin.listUsers();
            if (error) {
              adminApiError = error.message;
            } else {
              adminApiSuccess = true;
              userCount = data?.users?.length || 0;
            }
          } catch (e: any) {
            adminApiError = e.message;
          }
        } else {
          adminApiError = "No service role key detected, skipping auth admin test";
        }
        
        return new Response(
          JSON.stringify({
            supabaseUrl: url,
            keyUsedName,
            keyLength: keyUsed.length,
            roleClaim: decoded?.role || "unknown",
            decodedPayload: decoded,
            adminApiSuccess,
            adminApiError,
            userCount
          }),
          {
            status: 200,
            headers: {
              "Content-Type": "application/json",
              "Access-Control-Allow-Origin": "*"
            }
          }
        );
      }
    }
  }
});
