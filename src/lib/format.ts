export const fmtCurrency = (n: number | null | undefined) => {
  const v = Number(n ?? 0);
  return "₹" + v.toLocaleString("en-IN", { maximumFractionDigits: 2 });
};
export const fmtDate = (d: string | Date | null | undefined) => {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return dt.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};
export const todayISO = () => new Date().toISOString().slice(0, 10);
export const agencyEmail = (agencyCode: string, username: string) =>
  `${username.trim().toLowerCase()}@${agencyCode.trim().toLowerCase()}.agency.local`;

export const formatDate = fmtDate;
