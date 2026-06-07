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

              const subject = `Daily Accounts Report - ${agency.name} - ${fmtDate(todayStr)}`;
              const html = `
                <div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: 0 auto; padding: 0; border: 1px solid #e2e8f0; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05), 0 2px 4px -1px rgba(0,0,0,0.03); background-color: #ffffff;">
                  <div style="background: linear-gradient(135deg, #1e3c5e 0%, #12253a 100%); padding: 30px 24px; text-align: center; color: #ffffff;">
                    <h1 style="margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.5px;">Daily Accounts Report</h1>
                    <p style="margin: 5px 0 0 0; font-size: 14px; opacity: 0.85;">${agency.name}</p>
                  </div>
                  <div style="padding: 24px; color: #334155;">
                    <p style="margin: 0 0 16px 0; font-size: 15px; line-height: 1.6; color: #475569;">
                      Here is your daily automated accounts backup report for <strong>${agency.name}</strong> for the date of <strong>${fmtDate(todayStr)}</strong>.
                    </p>
                    <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; margin: 20px 0;">
                      <h3 style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #1e293b;">Report Details</h3>
                      <table style="width: 100%; border-collapse: collapse; font-size: 14px;">
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                          <td style="padding: 8px 0; color: #64748b;">Report Date:</td>
                          <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #0f172a;">${fmtDate(todayStr)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                          <td style="padding: 8px 0; color: #64748b;">Total Received:</td>
                          <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #16a34a;">₹${metrics.leftGrandTotal.toFixed(2)}</td>
                        </tr>
                        <tr style="border-bottom: 1px solid #e2e8f0;">
                          <td style="padding: 8px 0; color: #64748b;">Total Paid Outflows:</td>
                          <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #dc2626;">₹${metrics.totalOutflows.toFixed(2)}</td>
                        </tr>
                        <tr>
                          <td style="padding: 10px 0 0 0; font-weight: bold; color: #1e293b; font-size: 15px;">Net Cash Balance:</td>
                          <td style="padding: 10px 0 0 0; text-align: right; font-weight: bold; color: #1e3c5e; font-size: 15px;">₹${metrics.cashBalance.toFixed(2)}</td>
                        </tr>
                      </table>
                    </div>
                    <div style="border-left: 4px solid #1e3c5e; background-color: #eff6ff; padding: 12px 16px; border-radius: 0 8px 8px 0; margin-bottom: 24px;">
                      <p style="margin: 0; font-size: 13px; line-height: 1.5; color: #1e40af;">
                        <strong>Attachment:</strong> A fully detailed, formatted Excel worksheet (containing the Cash Book, Sales Log, and Udhari Ledger) is attached to this email.
                      </p>
                    </div>
                    <p style="margin: 0; font-size: 13px; color: #94a3b8; text-align: center; border-top: 1px solid #f1f5f9; padding-top: 16px;">
                      This backup was compiled and sent automatically at 9:30 PM IST. Please keep this email for your records.
                    </p>
                  </div>
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
