import { createFileRoute } from "@tanstack/react-router";
import { RequireAgencyUser } from "@/components/route-guards";
import { useState, useEffect } from "react";
import { useAuth } from "@/lib/auth-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { getMe, updateUserProfile, updateAgencyLogo } from "@/lib/auth.functions";
import { saveBackupSettings, sendManualBackupEmail } from "@/lib/backup.functions";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { 
  Mail, Save, Send, Download, MailCheck, Trash2, Plus, 
  Settings2, Loader2, Sparkles, FileSpreadsheet, ShieldAlert,
  User, Upload, Image, Camera
} from "lucide-react";
import * as XLSXStyle from "xlsx-js-style";
import { fmtDate } from "@/lib/format";

export const Route = createFileRoute("/app/profile")({
  component: () => (
    <RequireAgencyUser>
      <ProfilePage />
    </RequireAgencyUser>
  ),
});

function ProfilePage() {
  const meFn = useServerFn(getMe);
  const queryClient = useQueryClient();
  const { data: me, isLoading: meLoading } = useQuery({ 
    queryKey: ["me"], 
    queryFn: () => meFn() 
  });
  
  const saveSettingsFn = useServerFn(saveBackupSettings);
  const sendManualFn = useServerFn(sendManualBackupEmail);
  const updateProfileFn = useServerFn(updateUserProfile);
  const updateLogoFn = useServerFn(updateAgencyLogo);

  const [emails, setEmails] = useState<string[]>([]);
  const [newEmail, setNewEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [sendingManual, setSendingManual] = useState(false);
  const [exportingHistory, setExportingHistory] = useState(false);

  // Profile fields state
  const [username, setUsername] = useState("");
  const [fullName, setFullName] = useState("");
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingLogo, setSavingLogo] = useState(false);

  // User-friendly error translator
  function getFriendlyErrorMessage(err: any): string {
    if (!err) return "An unexpected error occurred. Please try again.";
    const message = err.message || String(err);
    
    // Parse Zod errors if they are in JSON string format
    if (message.startsWith("[") || message.includes('"code":')) {
      try {
        const parsed = JSON.parse(message);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed.map(issue => {
            const field = issue.path?.join(".") || "input";
            const label = field.charAt(0).toUpperCase() + field.slice(1);
            return `${label}: ${issue.message}`;
          }).join(", ");
        }
      } catch (_) {}
      return "Please double-check that all fields are filled out correctly.";
    }
    
    if (message.includes("is already in the list")) {
      return "This email is already in your backup list.";
    }
    if (message.includes("maximum of 3")) {
      return "You can configure a maximum of 3 backup email addresses.";
    }
    if (message.includes("taken") || message.includes("username already exists") || message.includes("duplicate key")) {
      return "This username is already taken. Please choose a different one.";
    }
    if (message.includes("password is too short")) {
      return "Your password must be at least 8 characters long.";
    }
    if (message.includes("Unauthorized") || message.includes("Forbidden")) {
      return "You do not have permission to modify these settings.";
    }
    
    return message;
  }

  // Populate state from user/agency details when loaded
  useEffect(() => {
    if (me?.agency?.backup_emails) {
      setEmails(me.agency.backup_emails);
    }
    if (me?.user) {
      setUsername(me.user.username || "");
      setFullName(me.user.full_name || "");
    }
    if (me?.agency) {
      setLogoUrl(me.agency.logo_url || null);
    }
  }, [me]);

  const addEmail = (e: React.FormEvent) => {
    e.preventDefault();
    const email = newEmail.trim().toLowerCase();
    if (!email) return;

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      toast.error("Please enter a valid email address.");
      return;
    }

    if (emails.includes(email)) {
      toast.error("This email is already added.");
      return;
    }

    if (emails.length >= 3) {
      toast.error("You can configure up to 3 backup emails.");
      return;
    }

    setEmails([...emails, email]);
    setNewEmail("");
  };

  const removeEmail = (index: number) => {
    setEmails(emails.filter((_, i) => i !== index));
  };

  const handleSave = async () => {
    if (emails.length === 0) {
      toast.error("Please add at least one backup email address before saving.");
      return;
    }
    setSaving(true);
    try {
      await saveSettingsFn({ emails });
      toast.success("Backup settings saved! A test report has been sent to your emails.");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e: any) {
      toast.error(getFriendlyErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleSendManual = async () => {
    if (emails.length === 0) {
      toast.error("Please save at least one backup email address first.");
      return;
    }
    setSendingManual(true);
    try {
      await sendManualFn();
      toast.success("Today's accounts report has been sent to your email(s)!");
    } catch (e: any) {
      toast.error(getFriendlyErrorMessage(e));
    } finally {
      setSendingManual(false);
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanUsername = username.trim().toLowerCase();
    const cleanFullName = fullName.trim();
    
    if (!cleanUsername) {
      toast.error("Please enter a username.");
      return;
    }
    if (cleanUsername.length < 3) {
      toast.error("Username must be at least 3 characters.");
      return;
    }
    if (!/^[a-zA-Z0-9_.-]+$/.test(cleanUsername)) {
      toast.error("Username can only contain letters, numbers, dots, dashes, and underscores.");
      return;
    }
    if (!cleanFullName) {
      toast.error("Please enter your full name.");
      return;
    }

    setSavingProfile(true);
    try {
      await updateProfileFn({
        username: cleanUsername,
        fullName: cleanFullName,
      });
      toast.success("Your profile details have been updated successfully!");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e: any) {
      toast.error(getFriendlyErrorMessage(e));
    } finally {
      setSavingProfile(false);
    }
  };

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      toast.error("Please upload an image file.");
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image size should be less than 5MB.");
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement("canvas");
        const MAX_WIDTH = 256;
        const MAX_HEIGHT = 256;
        let width = img.width;
        let height = img.height;

        if (width > height) {
          if (width > MAX_WIDTH) {
            height *= MAX_WIDTH / width;
            width = MAX_WIDTH;
          }
        } else {
          if (height > MAX_HEIGHT) {
            width *= MAX_HEIGHT / height;
            height = MAX_HEIGHT;
          }
        }

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height);
          const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
          saveLogo(dataUrl);
        }
      };
      img.src = event.target?.result as string;
    };
    reader.readAsDataURL(file);
  };

  const saveLogo = async (logoData: string | null) => {
    setSavingLogo(true);
    try {
      await updateLogoFn({
        logoUrl: logoData
      });
      setLogoUrl(logoData);
      toast.success(logoData ? "Your brand logo has been updated!" : "Logo removed. The default icon will now be shown.");
      void queryClient.invalidateQueries({ queryKey: ["me"] });
    } catch (e: any) {
      toast.error(getFriendlyErrorMessage(e));
    } finally {
      setSavingLogo(false);
    }
  };

  const handleRemoveLogo = () => {
    saveLogo(null);
  };

  // Client-side 10x10 grid historical Excel generation
  const handleDownloadHistory = async () => {
    if (!me?.agency?.id) return;
    setExportingHistory(true);
    try {
      toast.info("Gathering your financial history, please wait...");

      // 1. Fetch all cash book days
      const { data: cbDays, error: cbErr } = await supabase
        .from("cash_book_days")
        .select("book_date, opening_cash, actual_closing, notes")
        .eq("agency_id", me.agency.id)
        .order("book_date", { ascending: true });

      if (cbErr) throw new Error("Could not load your cash book history. Please try again.");

      if (!cbDays || cbDays.length === 0) {
        toast.warning("No financial records found yet. Start recording your daily sales to enable history export.");
        setExportingHistory(false);
        return;
      }

      const minDate = cbDays[0].book_date;
      const maxDate = cbDays[cbDays.length - 1].book_date;

      // 2. Fetch sales, payments, expenses between minDate and maxDate
      const [salesRes, paymentsRes, expensesRes] = await Promise.all([
        supabase
          .from("sales")
          .select(`quantity, rate, gross_amount, commission_amount, payment_mode, notes, sale_date,
            customer:customers(name), product:products(name),
            delivery_boy:delivery_boys(name), delivery_boy_id`)
          .eq("agency_id", me.agency.id)
          .eq("is_deleted", false)
          .gte("sale_date", minDate)
          .lte("sale_date", maxDate),
        supabase
          .from("payments")
          .select("amount, mode, remarks, payment_date, customer:customers(name)")
          .eq("agency_id", me.agency.id)
          .eq("is_deleted", false)
          .gte("payment_date", minDate)
          .lte("payment_date", maxDate),
        supabase
          .from("expenses")
          .select("category, amount, notes, expense_date, delivery_boy:delivery_boys(name)")
          .eq("agency_id", me.agency.id)
          .eq("is_deleted", false)
          .gte("expense_date", minDate)
          .lte("expense_date", maxDate)
      ]);

      if (salesRes.error) throw new Error("Could not load sales records. Please try again.");
      if (paymentsRes.error) throw new Error("Could not load payment records. Please try again.");
      if (expensesRes.error) throw new Error("Could not load expense records. Please try again.");

      // 3. Group lists by date in memory
      const salesByDate: Record<string, any[]> = {};
      const paymentsByDate: Record<string, any[]> = {};
      const expensesByDate: Record<string, any[]> = {};

      (salesRes.data ?? []).forEach(s => {
        const d = s.sale_date;
        if (!salesByDate[d]) salesByDate[d] = [];
        salesByDate[d].push(s);
      });
      (paymentsRes.data ?? []).forEach(p => {
        const d = p.payment_date;
        if (!paymentsByDate[d]) paymentsByDate[d] = [];
        paymentsByDate[d].push(p);
      });
      (expensesRes.data ?? []).forEach(e => {
        const d = e.expense_date;
        if (!expensesByDate[d]) expensesByDate[d] = [];
        expensesByDate[d].push(e);
      });

      // 4. Group cbDays by date
      const cbDaysMap: Record<string, any> = {};
      cbDays.forEach(day => {
        cbDaysMap[day.book_date] = day;
      });

      // Parse YYYY-MM-DD safely into a local date object at 12:00 PM (noon) to avoid timezone shifts
      const parseDateSafe = (dStr: string) => {
        const [y, m, d] = dStr.split("-").map(Number);
        return new Date(y, m - 1, d, 12, 0, 0, 0);
      };
      const start = parseDateSafe(minDate);
      const end = parseDateSafe(maxDate);
      const dateList: string[] = [];
      let currentIter = new Date(start);
      while (currentIter <= end) {
        const y = currentIter.getFullYear();
        const m = String(currentIter.getMonth() + 1).padStart(2, "0");
        const d = String(currentIter.getDate()).padStart(2, "0");
        dateList.push(`${y}-${m}-${d}`);
        currentIter.setDate(currentIter.getDate() + 1);
      }

      toast.info(`Building Excel workbook for ${dateList.length} days of records...`);

      // Compile each day
      let runningClosingCash = 0;
      const compiledDays = dateList.map((dStr) => {
        const dayRecord = cbDaysMap[dStr];
        let opening = runningClosingCash;
        let otherReceiptsList: any[] = [];
        let pendingBills: any[] = [];
        let magilBills: any[] = [];
        let paymentInflows: any[] = [];
        let paymentOutflows: any[] = [];
        let outstandingEntries: any[] = [];
        let manualCashEntry = "";
        let dailyNote = "";

        if (dayRecord) {
          opening = dayRecord.opening_cash ?? 0;
          if (dayRecord.notes) {
            try {
              const m = JSON.parse(dayRecord.notes);
              otherReceiptsList = (Array.isArray(m.other_receipts) ? m.other_receipts : []).map((r: any) => ({
                ...r,
                amount: Number(r.amount || 0)
              }));
              pendingBills = (Array.isArray(m.pending_bills) ? m.pending_bills : []).map((b: any) => ({
                ...b,
                qty: Number(b.qty || 0),
                rate: Number(b.rate || 0),
                amount: Number(b.amount || 0)
              }));
              magilBills = (Array.isArray(m.magil_bills) ? m.magil_bills : []).map((b: any) => ({
                ...b,
                qty: Number(b.qty || 0),
                rate: Number(b.rate || 0),
                amount: Number(b.amount || 0)
              }));
              paymentInflows = (Array.isArray(m.payment_inflows) ? m.payment_inflows : []).map((p: any) => ({
                ...p,
                amount: Number(p.amount || 0),
                split_online: Number(p.split_online || 0),
                split_credit: Number(p.split_credit || 0)
              }));
              paymentOutflows = (Array.isArray(m.payment_outflows) ? m.payment_outflows : []).map((p: any) => ({
                ...p,
                amount: Number(p.amount || 0)
              }));
              outstandingEntries = (Array.isArray(m.outstanding_entries) ? m.outstanding_entries : []).map((o: any) => ({
                ...o,
                amount: Number(o.amount || 0)
              }));
              manualCashEntry = m.manual_cash_entry != null ? String(m.manual_cash_entry) : "";
              dailyNote = m.daily_note ?? "";
            } catch (_) {}
          }
        }

        const rawSales = salesByDate[dStr] ?? [];
        const dailySales = rawSales.map((s: any) => {
          let pm = s.payment_mode?.toLowerCase() || "cash";
          let prepQty = 0;
          try {
            const m = JSON.parse(s.notes ?? "{}");
            if (m.is_cheque) pm = "cheque";
            if (m.website_prepaid_qty != null) {
              prepQty = Number(m.website_prepaid_qty);
            }
          } catch (_) {}
          const quantity = Number(s.quantity);
          const rate = Number(s.rate || 0);
          const grossAmount = quantity * rate;
          return {
            customer_name: s.customer?.name ?? "Walk-in",
            product_name: s.product?.name ?? "Cylinder",
            quantity,
            rate,
            total: grossAmount,
            gross_amount: grossAmount,
            payment_mode: pm,
            commission_total: Number(s.commission_amount || 0),
            notes: s.notes,
            delivery_boy_id: s.delivery_boy_id,
            delivery_boy_name: s.delivery_boy?.name ?? null,
          };
        });

        const rawPayments = paymentsByDate[dStr] ?? [];
        const dailyPayments = rawPayments.map((p: any) => ({
          customer_name: p.customer?.name ?? "—",
          amount: Number(p.amount),
          payment_mode: p.remarks?.startsWith("[CHEQUE]") ? "cheque" : (p.mode?.toLowerCase() || "cash"),
        }));

        const dailyExpenses = expensesByDate[dStr] ?? [];

        // Calculation variables
        const openingCash = Number(opening || 0);
        let homeTotal = 0, homeQty = 0, cncTotal = 0, cncQty = 0;
        const productSalesTotals: Record<string, { quantity: number; total: number }> = {};
        const commissionByDriver: Record<string, { name: string; amount: number; qty: number }> = {};
        const onlineByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
        let onlineQtyTotal = 0;
        const prepByDriver: Record<string, { name: string; qty: number; amount: number }> = {};
        let prepQtyTotal = 0;
        const chequeByCustomer: Record<string, { name: string; amount: number }> = {};
        const udhariByCustomer: Record<string, { name: string; amount: number }> = {};

        dailySales.forEach((s) => {
          const nl = s.product_name.toLowerCase();
          const isMain = nl.includes("14.2") || nl.includes("14 kg") || nl.includes("domestic") || nl.includes("cylinder") || nl === "lpg" || nl === "gas";
          const isHome = nl.includes("home") || nl.includes("delivery") || (!!s.delivery_boy_id && !nl.includes("cnc"));
          const isCNC = !isHome;

          let isSplit = false;
          let onlineAmt = 0;
          let creditAmt = 0;
          let prepQty = 0;
          try {
            const m = JSON.parse(s.notes ?? "{}");
            if (m.is_split) {
              isSplit = true;
              onlineAmt = Number(m.online_amount || 0);
              creditAmt = Number(m.credit_amount || 0);
            }
            if (m.website_prepaid_qty != null) {
              prepQty = Number(m.website_prepaid_qty);
            }
          } catch (_) {}

          if (isMain) {
            if (isCNC) { cncTotal += s.total; cncQty += s.quantity; }
            else { homeTotal += s.total; homeQty += s.quantity; }
          } else {
            if (!productSalesTotals[s.product_name]) productSalesTotals[s.product_name] = { quantity: 0, total: 0 };
            productSalesTotals[s.product_name].quantity += s.quantity;
            productSalesTotals[s.product_name].total += s.total;
          }

          if (s.commission_total > 0 && s.delivery_boy_name) {
            const n = s.delivery_boy_name;
            if (!commissionByDriver[n]) commissionByDriver[n] = { name: n, amount: 0, qty: 0 };
            commissionByDriver[n].amount += s.commission_total;
            commissionByDriver[n].qty += s.quantity;
          }

          if (prepQty > 0) {
            const prepAmt = prepQty * Number(s.rate);
            const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
            if (!prepByDriver[dbKey]) prepByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
            prepByDriver[dbKey].qty += prepQty;
            prepByDriver[dbKey].amount += prepAmt;
            prepQtyTotal += prepQty;
          }

          const isOnlineOrPaytmSale = !isSplit && (s.payment_mode === "online" || s.payment_mode === "paytm");
          const effectiveOnline = isSplit ? onlineAmt : (isOnlineOrPaytmSale ? (s.gross_amount - s.commission_total) : 0);
          if (effectiveOnline > 0) {
            const qrQty = isSplit ? 0 : s.quantity;
            const dbKey = s.delivery_boy_name ?? "Counter / Walk-in";
            if (!onlineByDriver[dbKey]) onlineByDriver[dbKey] = { name: dbKey, qty: 0, amount: 0 };
            onlineByDriver[dbKey].qty += qrQty;
            onlineByDriver[dbKey].amount += effectiveOnline;
            onlineQtyTotal += qrQty;
          }

          const effectiveCredit = isSplit ? creditAmt : (s.payment_mode === "credit" ? (s.gross_amount - s.commission_total) : 0);
          if (effectiveCredit > 0) {
            const cn = s.customer_name ?? "Unknown";
            if (!udhariByCustomer[cn]) udhariByCustomer[cn] = { name: cn, amount: 0 };
            udhariByCustomer[cn].amount += effectiveCredit;
          }

          if (s.payment_mode === "cheque" && !isSplit) {
            const cn = s.customer_name ?? "Walk-in";
            if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
            chequeByCustomer[cn].amount += (s.gross_amount - s.commission_total);
          }
        });

        dailyPayments.forEach((p) => {
          if (p.payment_mode === "cheque") {
            const cn = p.customer_name ?? "—";
            if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
            chequeByCustomer[cn].amount += p.amount;
          }
        });

        let inflowOnlineSum = 0;
        let inflowCreditSum = 0;
        let inflowChequeSum = 0;
        const onlineInflowRows: Array<{ name: string; amount: number }> = [];
        const udhariInflowRows: Array<{ name: string; amount: number }> = [];

        paymentInflows.forEach((p: any) => {
          if (p.payment_type === "cheque") {
            inflowChequeSum += p.amount;
            const cn = p.particular || "Cheque Inflow";
            if (!chequeByCustomer[cn]) chequeByCustomer[cn] = { name: cn, amount: 0 };
            chequeByCustomer[cn].amount += p.amount;
          } else if (p.payment_type === "upi" || p.payment_type === "online") {
            inflowOnlineSum += p.amount;
            onlineInflowRows.push({
              name: `${p.particular || "UPI Inflow"} (${p.payment_type === "upi" ? "UPI" : "Online"})`,
              amount: p.amount,
            });
          } else if (p.payment_type === "split") {
            const onlinePart = Number(p.split_online || 0);
            const creditPart = Number(p.split_credit || 0);
            
            if (onlinePart > 0) {
              inflowOnlineSum += onlinePart;
              onlineInflowRows.push({
                name: `${p.particular || "Split Inflow"} (Online)`,
                amount: onlinePart,
              });
            }
            if (creditPart > 0) {
              inflowCreditSum += creditPart;
              udhariInflowRows.push({
                name: `${p.particular || "Split Inflow"} (Udhari)`,
                amount: creditPart,
              });
            }
          }
        });

        const collectionsTotal = dailyPayments.reduce((s, p) => s + p.amount, 0);
        const otherInflowsSum = otherReceiptsList.reduce((s, r) => s + r.amount, 0);
        const pendingBillsTotal = pendingBills.reduce((s, b) => s + b.amount, 0);
        const paymentInflowsTotal = paymentInflows.reduce((s, p) => s + p.amount, 0);

        const prepSales = Object.values(prepByDriver).reduce((s, d) => s + d.amount, 0);
        const upiSales = Object.values(onlineByDriver).reduce((s, d) => s + d.amount, 0);
        const chequeSales = dailySales.filter(s => s.payment_mode === "cheque").reduce((a, r) => a + (r.gross_amount - r.commission_total), 0);
        const udhariSales = Object.values(udhariByCustomer).reduce((s, c) => s + c.amount, 0);

        const paytmRecoveries = dailyPayments.filter(p => p.payment_mode === "paytm").reduce((a, r) => a + r.amount, 0);
        const onlineRecoveries = dailyPayments.filter(p => p.payment_mode === "online").reduce((a, r) => a + r.amount, 0);
        const chequeRecoveries = dailyPayments.filter(p => p.payment_mode === "cheque").reduce((a, r) => a + r.amount, 0);

        const prepOutflow = prepSales;
        const upiOutflow = upiSales + paytmRecoveries + onlineRecoveries + inflowOnlineSum;
        const chequeOutflow = chequeSales + chequeRecoveries + inflowChequeSum;
        const udhariOutflow = udhariSales + inflowCreditSum;

        const otherProductSalesSum = Object.values(productSalesTotals).reduce((s, r) => s + r.total, 0);
        const leftGrandTotal = openingCash + homeTotal + cncTotal + otherProductSalesSum + collectionsTotal + otherInflowsSum + pendingBillsTotal + paymentInflowsTotal;

        const expensesTotal = dailyExpenses.reduce((s: number, e: any) => s + Number(e.amount), 0);
        const commissionsTotal = Object.values(commissionByDriver).reduce((s, d) => s + d.amount, 0);
        const magilBillsTotal = magilBills.reduce((s, b) => s + b.amount, 0);
        const paymentOutflowsTotal = paymentOutflows.reduce((s, p) => s + p.amount, 0);
        const outstandingTotal = outstandingEntries.reduce((s, o) => s + o.amount, 0);

        const totalOutflows = expensesTotal + prepOutflow + upiOutflow + chequeOutflow + udhariOutflow + commissionsTotal + magilBillsTotal + paymentOutflowsTotal + outstandingTotal;
        const cashBalance = leftGrandTotal - totalOutflows;
        const manualNum = manualCashEntry === "" ? null : Number(manualCashEntry);
        const cashDifference = manualNum != null ? manualNum - Math.abs(cashBalance) : null;

        runningClosingCash = cashBalance;

        return {
          date: dStr,
          openingCash,
          homeTotal, homeQty, cncTotal, cncQty,
          productSalesTotals, collectionsTotal, otherInflowsSum,
          pendingBillsTotal, paymentInflowsTotal,
          leftGrandTotal, expensesTotal, commissionsTotal,
          commissionByDriver, onlineByDriver, onlineQtyTotal,
          prepOutflow, prepByDriver, prepQtyTotal,
          chequeByCustomer,
          udhariByCustomer, udhariOutflow, upiOutflow,
          chequeOutflow, magilBillsTotal, paymentOutflowsTotal,
          outstandingTotal, outstandingEntries,
          totalOutflows, cashBalance, cashDifference,
          manualCashEntry,
          onlineInflowRows, udhariInflowRows,
          otherReceiptsList, pendingBills, magilBills, paymentInflows, paymentOutflows,
          dailyExpenses, dailyPayments, dailySales,
          dailyNote
        };
      });

      // 5. Generate Grid workbook
      const wb = XLSXStyle.utils.book_new();
      const ws: any = {};

      const C = {
        titleBg:   "1A3C5E",
        titleFg:   "FFFFFF",
        hdrBg:     "2E75B6",
        hdrFg:     "FFFFFF",
        totRecBg:  "1F7A4D",
        totRecFg:  "FFFFFF",
        totPaidBg: "1F7A4D",
        totPaidFg: "FFFFFF",
        sumHdrBg:  "1A3C5E",
        sumHdrFg:  "FFFFFF",
        sumBalBg:  "C6EFCE",
        sumBalFg:  "375623",
        sumBalYelBg: "FFF2CC",
        sumBalYelFg: "7F6000",
        sumDiffBg: "FFC7CE",
        sumDiffFg: "9C0006",
        altRowBg:  "EBF3FB",
        subRowBg:  "F5F5F5",
        borderCol: "BFBFBF",
      };

      const border = {
        top:    { style: "thin", color: { rgb: C.borderCol } },
        bottom: { style: "thin", color: { rgb: C.borderCol } },
        left:   { style: "thin", color: { rgb: C.borderCol } },
        right:  { style: "thin", color: { rgb: C.borderCol } },
      };

      const thickBorder = {
        top:    { style: "medium", color: { rgb: "1A3C5E" } },
        bottom: { style: "medium", color: { rgb: "1A3C5E" } },
        left:   { style: "medium", color: { rgb: "1A3C5E" } },
        right:  { style: "medium", color: { rgb: "1A3C5E" } },
      };

      const W = (
        row: number, col: number, v: any,
        opts: {
          bold?: boolean; italic?: boolean; sz?: number;
          fg?: string; bg?: string; align?: string;
          border?: any; numFmt?: string; color?: string;
        } = {}
      ) => {
        const addr = XLSXStyle.utils.encode_cell({ r: row, c: col });
        const isNum = typeof v === "number";
        ws[addr] = {
          v,
          t: isNum ? "n" : "s",
          s: {
            font: {
              bold: opts.bold ?? false,
              italic: opts.italic ?? false,
              sz: opts.sz ?? 10,
              color: { rgb: opts.fg ?? opts.color ?? "000000" },
              name: "Calibri",
            },
            fill: opts.bg ? { fgColor: { rgb: opts.bg }, patternType: "solid" } : undefined,
            alignment: {
              horizontal: opts.align ?? (isNum ? "right" : "left"),
              vertical: "center",
              wrapText: false,
            },
            border: opts.border ?? border,
            numFmt: opts.numFmt ?? (isNum ? "#,##0.00" : "@"),
          },
        };
      };

      const BLANK = (row: number, col: number, bg?: string) => {
        const addr = XLSXStyle.utils.encode_cell({ r: row, c: col });
        ws[addr] = {
          v: "", t: "s",
          s: {
            fill: bg ? { fgColor: { rgb: bg }, patternType: "solid" } : undefined,
            border,
          },
        };
      };

      // Divide days into groups of 10
      const groupSize = 10;
      let currentGroupStartRow = 0;
      let overallMaxCol = 0;

      for (let g = 0; g < compiledDays.length; g += groupSize) {
        const groupDays = compiledDays.slice(g, g + groupSize);
        
        // 1. Prepare data structures for each day in the group
        type XRow = { label: string; qty: number | ""; amt: number; sub?: boolean };
        const groupLefts: XRow[][] = [];
        const groupRights: XRow[][] = [];
        
        groupDays.forEach((day, index) => {
          const left: XRow[] = [];
          const right: XRow[] = [];

          left.push({ label: "Opening Cash Balance", qty: "", amt: day.openingCash });
          Object.entries(day.productSalesTotals).forEach(([n, s]) => left.push({ label: `${n} Sales`, qty: s.quantity, amt: s.total }));
          if (day.collectionsTotal > 0) {
            left.push({ label: "Credit Recovery / Outstanding Collections", qty: "", amt: day.collectionsTotal });
            day.dailyPayments.forEach(p => left.push({ label: `  - ${p.customer_name} (${p.payment_mode})`, qty: "", amt: p.amount, sub: true }));
          }

          day.otherReceiptsList.forEach(r => left.push({ label: r.particular, qty: "", amt: r.amount }));
          day.pendingBills.forEach(b => left.push({ label: `Pending — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));
          day.paymentInflows.forEach(p => left.push({ label: p.particular + (p.note ? ` (${p.note})` : ""), qty: "", amt: p.amount }));
          if (day.homeTotal > 0) left.push({ label: "14 KG Home Delivery Sales", qty: day.homeQty, amt: day.homeTotal });
          if (day.cncTotal > 0)  left.push({ label: "14 KG CNC Sales",           qty: day.cncQty,  amt: day.cncTotal });

           day.dailyExpenses.forEach((e: any) => {
             let cat = e.category, note = e.notes ?? "";
             let workerName = "";
             if (note.startsWith("[OTHER_CAT:")) {
               const m = note.match(/^\[OTHER_CAT:([^\]]+)\]/);
               if (m) { cat = m[1]; note = note.replace(/^\[OTHER_CAT:[^\]]+\]\s*/, ""); }
             }
             if (e.delivery_boy?.name) {
               workerName = e.delivery_boy.name;
             } else if (note.startsWith("[WORKER:")) {
               const m = note.match(/^\[WORKER:([^\]]+)\]/);
               if (m) { workerName = m[1]; }
             }
             if (note.startsWith("[WORKER:")) {
               note = note.replace(/^\[WORKER:[^\]]+\]\s*/, "");
             }
             const safeCat = (cat || "").replace("_", " ");
             const label = workerName ? `${safeCat} (${workerName})` : safeCat;
             right.push({ label: `${label}${note ? ` (${note})` : ""}`, qty: "", amt: Number(e.amount) });
           });

          day.paymentOutflows.forEach(p => right.push({ label: p.particular + (p.note ? ` (${p.note})` : ""), qty: "", amt: p.amount }));
          day.magilBills.forEach(b => right.push({ label: `Magil — ${b.label} (${b.qty}×₹${b.rate})`, qty: b.qty, amt: b.amount }));

          if (day.chequeOutflow > 0) {
            right.push({ label: "Cheque", qty: "", amt: day.chequeOutflow });
            Object.values(day.chequeByCustomer).forEach((c: any) => right.push({ label: `  - ${c.name}`, qty: "", amt: c.amount, sub: true }));
          }

          if (day.udhariOutflow > 0) {
            right.push({ label: "Udhari", qty: "", amt: day.udhariOutflow });
            Object.values(day.udhariByCustomer).forEach((c: any) => right.push({ label: `  - ${c.name}`, qty: "", amt: c.amount, sub: true }));
            day.udhariInflowRows.forEach(r => right.push({ label: `  - ${r.name}`, qty: "", amt: r.amount, sub: true }));
          }

          if (day.outstandingTotal > 0) {
            right.push({ label: "Outstanding (Loans/Udhari Given)", qty: "", amt: day.outstandingTotal });
            day.outstandingEntries.forEach(o => right.push({ label: `  - ${o.customer_name}${o.note ? ` (${o.note})` : ""}`, qty: "", amt: o.amount, sub: true }));
          }

          if (day.upiOutflow > 0) {
            right.push({ label: "UPI / Paytm", qty: day.onlineQtyTotal, amt: day.upiOutflow });
            Object.values(day.onlineByDriver).forEach((d: any) => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
            day.onlineInflowRows.forEach(r => right.push({ label: `  - ${r.name}`, qty: "", amt: r.amount, sub: true }));
          }

          if (day.prepQtyTotal > 0) {
            right.push({ label: "Website Prepaid", qty: day.prepQtyTotal, amt: day.prepOutflow });
            Object.values(day.prepByDriver).forEach((d: any) => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
          }

          if (day.commissionsTotal > 0) {
            right.push({ label: "Route Commission Paid", qty: "", amt: day.commissionsTotal });
            Object.values(day.commissionByDriver).forEach((d: any) => right.push({ label: `  - ${d.name}`, qty: d.qty, amt: d.amount, sub: true }));
          }

          groupLefts.push(left);
          groupRights.push(right);
        });

        // 2. Find max data rows for this group
        const groupMaxData: number[] = [];
        groupLefts.forEach((_, idx) => {
          groupMaxData.push(Math.max(groupLefts[idx].length, groupRights[idx].length));
        });

        const overallMaxData = Math.max(...groupMaxData, 1);

        // 3. Fill in elements so all columns in group have same height
        groupLefts.forEach((left, idx) => {
          while (left.length  < overallMaxData) left.push({ label: "", qty: "", amt: 0 });
          while (groupRights[idx].length < overallMaxData) groupRights[idx].push({ label: "", qty: "", amt: 0 });
        });

        // 4. Calculate coordinates and draw each day
        groupDays.forEach((day, index) => {
          const colOffset = index * 8; // Each day takes 7 cols + 1 spacer
          overallMaxCol = Math.max(overallMaxCol, colOffset + 6);
          let r = currentGroupStartRow;

          const cleanQtyExcel = (q: any) => {
            if (q === 0 || q === "0" || q === "") return "";
            return q;
          };

          // Title
          const dayNum = g + index + 1;
          W(r, colOffset + 0, `Day ${dayNum} — ${fmtDate(day.date)}`, { bold: true, sz: 11, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
          BLANK(r, colOffset + 1, C.titleBg); BLANK(r, colOffset + 2, C.titleBg); BLANK(r, colOffset + 3, C.titleBg);
          W(r, colOffset + 4, `Cash Report — Day ${dayNum}`, { bold: true, sz: 11, fg: C.titleFg, bg: C.titleBg, align: "left", border: thickBorder });
          BLANK(r, colOffset + 5, C.titleBg); BLANK(r, colOffset + 6, C.titleBg);
          r++;

          // Spacer
          for (let c = 0; c < 7; c++) BLANK(r, colOffset + c);
          r++;

          // Header
          W(r, colOffset + 0, "PAYMENT RECEIVED", { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
          W(r, colOffset + 1, "Qty",        { bold: true, sz: 9, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
          W(r, colOffset + 2, "Amount (₹)",{ bold: true, sz: 9, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
          BLANK(r, colOffset + 3);
          W(r, colOffset + 4, "MONEY PAID / OUTFLOW",       { bold: true, sz: 10, fg: C.hdrFg, bg: C.hdrBg, align: "left", border: thickBorder });
          W(r, colOffset + 5, "Qty",        { bold: true, sz: 9, fg: C.hdrFg, bg: C.hdrBg, align: "center", border: thickBorder });
          W(r, colOffset + 6, "Amount (₹)",{ bold: true, sz: 9, fg: C.hdrFg, bg: C.hdrBg, align: "right",  border: thickBorder });
          r++;

          // Data rows
          const leftRows = groupLefts[index];
          const rightRows = groupRights[index];

          for (let i = 0; i < overallMaxData; i++) {
            const l = leftRows[i];
            const r2 = rightRows[i];
            const isAlt = i % 2 === 1;
            const rowBg = isAlt ? C.altRowBg : undefined;

            if (l.label) {
              const subBg = l.sub ? C.subRowBg : rowBg;
              W(r, colOffset + 0, l.label, { italic: l.sub, bg: subBg });
              const qtyVal = cleanQtyExcel(l.qty);
              if (qtyVal !== "") W(r, colOffset + 1, qtyVal, { align: "center", bg: subBg });
              else BLANK(r, colOffset + 1, subBg);
              W(r, colOffset + 2, l.amt || 0, { bg: subBg });
            } else {
              BLANK(r, colOffset + 0, rowBg); BLANK(r, colOffset + 1, rowBg); BLANK(r, colOffset + 2, rowBg);
            }

            BLANK(r, colOffset + 3);

            if (r2.label) {
              const subBg = r2.sub ? C.subRowBg : rowBg;
              W(r, colOffset + 4, r2.label, { italic: r2.sub, bg: subBg });
              const qtyVal = cleanQtyExcel(r2.qty);
              if (qtyVal !== "") W(r, colOffset + 5, qtyVal, { align: "center", bg: subBg });
              else BLANK(r, colOffset + 5, subBg);
              W(r, colOffset + 6, r2.amt || 0, { bg: subBg });
            } else {
              BLANK(r, colOffset + 4, rowBg); BLANK(r, colOffset + 5, rowBg); BLANK(r, colOffset + 6, rowBg);
            }

            r++;
          }

          // Grand Totals
          W(r, colOffset + 0, "TOTAL RECEIVED", { bold: true, sz: 10, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
          BLANK(r, colOffset + 1, C.totRecBg);
          W(r, colOffset + 2, day.leftGrandTotal, { bold: true, sz: 10, fg: C.totRecFg, bg: C.totRecBg, border: thickBorder });
          BLANK(r, colOffset + 3);
          W(r, colOffset + 4, "TOTAL PAID OUTFLOW", { bold: true, sz: 10, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
          BLANK(r, colOffset + 5, C.totPaidBg);
          W(r, colOffset + 6, day.totalOutflows, { bold: true, sz: 10, fg: C.totPaidFg, bg: C.totPaidBg, border: thickBorder });
          r++;

          // Spacer
          for (let c = 0; c < 7; c++) BLANK(r, colOffset + c);
          r++;

          // Summary section
          W(r, colOffset + 0, "SUMMARY", { bold: true, sz: 10, fg: C.sumHdrFg, bg: C.sumHdrBg, border: thickBorder });
          for (let c = 1; c < 7; c++) BLANK(r, colOffset + c, C.sumHdrBg);
          r++;

          W(r, colOffset + 0, "Total Inflows", { bold: false });
          BLANK(r, colOffset + 1); W(r, colOffset + 2, day.leftGrandTotal, { bold: true }); r++;

          W(r, colOffset + 0, "Total Outflows", { bold: false });
          BLANK(r, colOffset + 1); W(r, colOffset + 2, day.totalOutflows, { bold: true }); r++;

          const isBalZero = day.cashBalance === 0;
          const isBalPos = day.cashBalance > 0;
          const balBgExcel = isBalZero ? C.sumBalYelBg : isBalPos ? C.sumBalBg : C.sumDiffBg;
          const balFgExcel = isBalZero ? C.sumBalYelFg : isBalPos ? C.sumBalFg : C.sumDiffFg;
          W(r, colOffset + 0, "Calculated Cash Balance",  { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
          BLANK(r, colOffset + 1, balBgExcel);
          W(r, colOffset + 2, day.cashBalance, { bold: true, fg: balFgExcel, bg: balBgExcel, border: thickBorder });
          r++;

          if (day.cashDifference !== null) {
            W(r, colOffset + 0, "Physical Cash Count"); BLANK(r, colOffset + 1); W(r, colOffset + 2, Number(day.manualCashEntry ?? 0)); r++;
            const isBalanced = Math.abs(day.cashDifference) < 0.01;
            const isSurplus = day.cashDifference > 0;
            const diffBg = isBalanced ? C.sumBalYelBg : isSurplus ? C.sumBalBg : C.sumDiffBg;
            const diffFg = isBalanced ? C.sumBalYelFg : isSurplus ? C.sumBalFg : C.sumDiffFg;
            const diffLabel = isBalanced ? "Cash Diff (Balanced)" : isSurplus ? "Cash Diff (Surplus)" : "Cash Diff (Shortage)";
            W(r, colOffset + 0, diffLabel, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
            BLANK(r, colOffset + 1, diffBg);
            W(r, colOffset + 2, day.cashDifference, { bold: true, fg: diffFg, bg: diffBg, border: thickBorder });
            r++;
          }

          if (day.dailyNote.trim()) {
            r++;
            W(r, colOffset + 0, `Note: ${day.dailyNote}`, { italic: true, fg: "555555" }); r++;
          }
        });

        // 5. Advance group start row pointer.
        // We find the max rows among all days in this group.
        const heights = groupDays.map((day) => {
          let h = 8 + overallMaxData; // Title(1) + Spacer(1) + Header(1) + data(overallMaxData) + Totals(1) + Spacer(1) + SummaryHeader(1) + Summary (3)
          if (day.cashDifference !== null) h += 2;
          if (day.dailyNote.trim()) h += 2;
          return h;
        });

        const maxGroupHeight = Math.max(...heights, 10);
        currentGroupStartRow += maxGroupHeight + 3; // Add vertical spacer of 3 rows between group rows
      }

      // Format column widths and set reference range
      const colsList = [];
      for (let c = 0; c <= overallMaxCol + 2; c++) {
        const indexInDay = c % 8;
        if (indexInDay === 0 || indexInDay === 4) {
          colsList.push({ wch: 32 }); // Label cols
        } else if (indexInDay === 1 || indexInDay === 5) {
          colsList.push({ wch: 6 });  // Qty cols
        } else if (indexInDay === 2 || indexInDay === 6) {
          colsList.push({ wch: 13 }); // Amount cols
        } else {
          colsList.push({ wch: 2 });  // Spacer cols
        }
      }
      ws["!cols"] = colsList;

      // Set worksheet range
      ws["!ref"] = XLSXStyle.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: currentGroupStartRow, c: overallMaxCol }
      });

      XLSXStyle.utils.book_append_sheet(wb, ws, "Financial History");
      
      const fileName = `ledger_history_${minDate}_to_${maxDate}.xlsx`;
      // Use browser-compatible download via Blob + anchor element
      const wbOut = XLSXStyle.write(wb, { bookType: "xlsx", type: "array" });
      const blob = new Blob([wbOut], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
      toast.success(`Your complete ledger history (${dateList.length} days) has been downloaded!`);
    } catch (e: any) {
      console.error("Historical Export Failed:", e);
      toast.error("Could not download your history. Please try again or contact support.");
    } finally {
      setExportingHistory(false);
    }
  };

  if (meLoading) {
    return (
      <div className="flex h-[50vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl mx-auto">
      {/* Header section */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-3xl font-extrabold tracking-tight flex items-center gap-2">
          <Settings2 className="h-8 w-8 text-primary animate-pulse" />
          Profile & Backup Settings
        </h1>
        <p className="text-muted-foreground text-sm">
          Manage your personal credentials, customize branding logo, and configure backup destinations.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-12">
        {/* Left Column: Profile & Branding Settings */}
        <div className="md:col-span-5 space-y-6">
          {/* User Profile Settings */}
          <Card className="border-muted-foreground/10 bg-card/60 backdrop-blur-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <User className="h-5 w-5 text-primary" />
                Personal Profile Details
              </CardTitle>
              <CardDescription>
                Update your login credentials and full name.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="username">Username</Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Username"
                    className="h-11"
                  />
                  <p className="text-[11px] text-muted-foreground">Changing this will update your login email.</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fullName">Full Name</Label>
                  <Input
                    id="fullName"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Full Name"
                    className="h-11"
                  />
                </div>
                <Button 
                  type="submit" 
                  disabled={savingProfile}
                  className="w-full h-11 font-bold bg-gradient-to-r from-primary to-primary/80 shadow-md mt-2"
                >
                  {savingProfile ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Saving Profile...
                    </>
                  ) : (
                    <>
                      <Save className="mr-2 h-4 w-4" /> Save Profile Details
                    </>
                  )}
                </Button>
              </form>
            </CardContent>
          </Card>

          {/* Agency Branding Logo */}
          <Card className="border-muted-foreground/10 bg-card/60 backdrop-blur-md shadow-xl">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Image className="h-5 w-5 text-primary" />
                Agency Branding Logo
              </CardTitle>
              <CardDescription>
                Upload a logo to replace the default sidebar icon.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 pt-1">
              <div className="flex flex-col items-center gap-4">
                {logoUrl ? (
                  <div className="relative group shadow-sm border rounded-xl overflow-hidden">
                    <img 
                      src={logoUrl} 
                      className="w-28 h-28 object-cover transition-all group-hover:opacity-85"
                      alt="Brand Logo" 
                    />
                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        onClick={handleRemoveLogo}
                        disabled={savingLogo}
                        className="h-8 px-2.5 text-xs font-bold shadow-md"
                      >
                        Remove Logo
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="w-28 h-28 rounded-xl bg-muted flex flex-col items-center justify-center border border-dashed border-muted-foreground/20 text-muted-foreground">
                    <Camera className="h-8 w-8 mb-1 opacity-40 text-muted-foreground" />
                    <span className="text-[11px] font-medium opacity-60">No custom logo</span>
                  </div>
                )}
                
                <div className="w-full flex justify-center pt-2">
                  <Label 
                    htmlFor="logo-upload" 
                    className="flex items-center gap-2 px-5 py-2.5 rounded-lg border border-muted-foreground/20 bg-muted/40 hover:bg-muted/60 cursor-pointer text-sm font-bold transition-all shadow-sm"
                  >
                    {savingLogo ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin text-primary" /> Uploading...
                      </>
                    ) : (
                      <>
                        <Upload className="h-4 w-4 text-primary" /> Choose Brand Image
                      </>
                    )}
                  </Label>
                  <input 
                    id="logo-upload" 
                    type="file" 
                    accept="image/*" 
                    onChange={handleLogoUpload} 
                    className="hidden" 
                    disabled={savingLogo}
                  />
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Column: Backup Email destinations & Manual Send */}
        <div className="md:col-span-7 space-y-6">
          <Card className="border-muted-foreground/10 bg-card/60 backdrop-blur-md shadow-xl overflow-hidden relative">
            <div className="absolute top-0 right-0 p-4">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
                <Sparkles className="h-3 w-3 animate-bounce" />
                Daily Backup at 9:30 PM IST
              </span>
            </div>

            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <Mail className="h-5 w-5 text-primary" />
                Backup Email Destinations
              </CardTitle>
              <CardDescription className="max-w-[80%]">
                Configure up to 3 email addresses where your daily account books and sales reports will be sent as Excel spreadsheets.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* Added emails list */}
              <div className="space-y-2.5">
                <Label className="text-sm font-semibold text-muted-foreground">Active Email Destinations ({emails.length}/3)</Label>
                {emails.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-8 px-4 border border-dashed rounded-xl bg-muted/20 text-muted-foreground border-muted-foreground/20">
                    <MailCheck className="h-10 w-10 mb-2 opacity-40 text-muted-foreground" />
                    <p className="text-sm font-medium">No email addresses configured</p>
                    <p className="text-xs mt-1">Add up to 3 emails below to enable automatic backups.</p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {emails.map((email, idx) => (
                      <div 
                        key={email} 
                        className="flex items-center justify-between px-4 py-3 rounded-xl border border-muted-foreground/10 bg-muted/40 transition-all hover:bg-muted/60 hover:shadow-sm"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="w-6 h-6 rounded-full bg-primary/10 text-primary flex items-center justify-center font-bold text-xs">
                            {idx + 1}
                          </span>
                          <span className="font-semibold text-sm truncate">{email}</span>
                        </div>
                        <Button 
                          variant="ghost" 
                          size="icon" 
                          onClick={() => removeEmail(idx)}
                          className="h-8 w-8 text-destructive hover:bg-destructive/10 rounded-lg"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Email input form */}
              {emails.length < 3 && (
                <form onSubmit={addEmail} className="flex gap-2">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="email" className="sr-only">Email address</Label>
                    <Input
                      id="email"
                      type="email"
                      placeholder="Enter email address (e.g. owner@gmail.com)"
                      value={newEmail}
                      onChange={(e) => setNewEmail(e.target.value)}
                      className="h-11"
                    />
                  </div>
                  <Button type="submit" variant="outline" className="h-11 px-4 font-semibold border-muted-foreground/20">
                    <Plus className="h-4 w-4 mr-1.5 text-primary" /> Add Email
                  </Button>
                </form>
              )}

              {/* Warning callout */}
              <div className="flex gap-3 p-4 rounded-xl bg-amber-500/10 text-amber-600 border border-amber-500/20 text-xs leading-relaxed">
                <ShieldAlert className="h-5 w-5 shrink-0" />
                <div>
                  <span className="font-bold">Automated Daily Backups:</span> Saving your settings triggers a test report email to all addresses. Daily ledger summaries are dispatched at <strong>9:30 PM IST</strong>.
                </div>
              </div>

              {/* Actions footer */}
              <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-muted-foreground/10">
                <Button 
                  onClick={handleSave} 
                  disabled={saving}
                  className="flex-1 h-11 font-bold bg-gradient-to-r from-primary to-primary/80 text-primary-foreground shadow-lg shadow-primary/25"
                >
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Saving Settings...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4 mr-2" /> Save Backup Settings
                    </>
                  )}
                </Button>
                <Button 
                  variant="outline" 
                  onClick={handleSendManual} 
                  disabled={sendingManual || emails.length === 0}
                  className="sm:w-48 h-11 font-bold border-muted-foreground/20 hover:bg-muted/50"
                >
                  {sendingManual ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Sending...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4 mr-2" /> Send on Mail
                    </>
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* History Archive Export */}
          <Card className="border-muted-foreground/10 bg-card/60 backdrop-blur-md shadow-xl overflow-hidden">
            <CardHeader>
              <CardTitle className="text-xl flex items-center gap-2">
                <FileSpreadsheet className="h-5 w-5 text-emerald-500" />
                Full Ledger History Export
              </CardTitle>
              <CardDescription>
                Compile your entire financial history from the start date up to today into a single Excel workbook formatted in a vertical-stack horizontal grid (10 days wide).
              </CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <Button 
                onClick={handleDownloadHistory} 
                disabled={exportingHistory}
                className="w-full h-12 font-bold bg-gradient-to-r from-emerald-600 to-emerald-500 text-white shadow-lg shadow-emerald-600/25 hover:from-emerald-700 hover:to-emerald-600"
              >
                {exportingHistory ? (
                  <>
                    <Loader2 className="h-5 w-5 mr-2 animate-spin" /> Compiling Ledger Archives...
                  </>
                ) : (
                  <>
                    <Download className="h-5 w-5 mr-2" /> Download Full History (Excel)
                  </>
                )}
              </Button>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
