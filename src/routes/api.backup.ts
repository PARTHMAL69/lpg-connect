import { createFileRoute } from "@tanstack/react-router";
import { getAdminClient } from "@/lib/auth.server";
import { compileDailyCashBookWorkbook, sendBackupEmail } from "@/lib/backup.functions";
import * as XLSXStyle from "xlsx-js-style";

function fmtDate(iso: string) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  } catch (_) {
    return iso;
  }
}

export const Route = createFileRoute("/api/backup")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        try {
          const admin = getAdminClient();
          
          // 1. Fetch all agencies with backup emails configured and not disabled
          const { data: agencies, error } = await admin
            .from("agencies")
            .select("id, name, backup_emails")
            .not("backup_emails", "is", null)
            .is("disabled_at", null);

          if (error) throw error;

          // Filter out agencies with empty email arrays in memory
          const activeBackupAgencies = (agencies ?? []).filter(
            (a) => Array.isArray(a.backup_emails) && a.backup_emails.length > 0
          );

          if (activeBackupAgencies.length === 0) {
            return new Response(JSON.stringify({ message: "No active agencies configured for daily email backups." }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }

          // Determine date in Indian Standard Time (IST = UTC + 5:30)
          const now = new Date();
          const utcTime = now.getTime() + now.getTimezoneOffset() * 60000;
          const istTime = new Date(utcTime + (3600000 * 5.5));
          const todayStr = istTime.toISOString().slice(0, 10);

          const results = [];

          for (const agency of activeBackupAgencies) {
            const emails = agency.backup_emails;
            if (!emails || emails.length === 0) continue;

            try {
              // Compile and generate Excel workbook
              const { wb, metrics } = await compileDailyCashBookWorkbook(admin, agency.id, todayStr);
              const buf = XLSXStyle.write(wb, { type: "buffer", bookType: "xlsx" });
              const base64 = buf.toString("base64");

              const subject = `[Auto-Backup] Daily Report - ${agency.name} - ${fmtDate(todayStr)}`;
              const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e2e8f0; border-radius: 8px;">
                  <h2 style="color: #1a3c5e; border-bottom: 2px solid #2e75b6; padding-bottom: 10px; margin-top: 0;">
                    Automated Daily Data Backup
                  </h2>
                  <p style="color: #4a5568; font-size: 15px; line-height: 1.6;">
                    Here is your daily automated cash book backup for <strong>${agency.name}</strong>.
                  </p>
                  <div style="background-color: #f7fafc; padding: 15px; border-radius: 6px; margin: 20px 0; border-left: 4px solid #2e75b6;">
                    <h4 style="margin: 0 0 10px 0; color: #2d3748;">Summary for ${fmtDate(todayStr)}:</h4>
                    <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                      <tr>
                        <td style="padding: 4px 0; color: #718096;">Total Received:</td>
                        <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #1f7a4d;">₹${metrics.leftGrandTotal.toFixed(2)}</td>
                      </tr>
                      <tr>
                        <td style="padding: 4px 0; color: #718096;">Total Paid Outflows:</td>
                        <td style="padding: 4px 0; text-align: right; font-weight: bold; color: #9c0006;">₹${metrics.totalOutflows.toFixed(2)}</td>
                      </tr>
                      <tr style="border-top: 1px solid #e2e8f0;">
                        <td style="padding: 6px 0 0 0; font-weight: bold; color: #2d3748;">Calculated Balance:</td>
                        <td style="padding: 6px 0 0 0; text-align: right; font-weight: bold; color: #1a3c5e;">₹${metrics.cashBalance.toFixed(2)}</td>
                      </tr>
                    </table>
                  </div>
                  <p style="color: #718096; font-size: 13px; margin-bottom: 0;">
                    This backup was compiled and sent automatically at 9:30 PM IST. 
                    Please keep this email for your records.
                  </p>
                </div>
              `;

              await sendBackupEmail({
                emails: emails,
                subject: subject,
                htmlContent: html,
                attachmentBase64: base64,
                filename: `cashbook_${todayStr}.xlsx`,
              });

              results.push({ agencyId: agency.id, name: agency.name, status: "success" });
            } catch (e: any) {
              console.error(`Failed auto-backup for agency ${agency.id}:`, e);
              results.push({ agencyId: agency.id, name: agency.name, status: "failed", error: e.message });
            }
          }

          return new Response(JSON.stringify({ date: todayStr, results }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        } catch (e: any) {
          console.error("[Backup API] Critical Error:", e);
          return new Response(JSON.stringify({ error: e.message }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }
      },
    },
  },
});
