export const formatINR = (n: number | string | null | undefined) => {
  const num = typeof n === "string" ? parseFloat(n) : (n ?? 0);
  if (!isFinite(num)) return "₹0";
  return "₹" + num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export const formatDate = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
};

export const formatDateTime = (d: string | Date | null | undefined) => {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("en-IN", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
};

export const toDateInput = (d: string | Date | null | undefined) => {
  if (!d) return new Date().toISOString().slice(0, 10);
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
};
