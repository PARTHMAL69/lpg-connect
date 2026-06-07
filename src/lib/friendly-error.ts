/**
 * Converts technical error messages into user-friendly messages
 * suitable for toast notifications.
 */
export function getFriendlyError(err: unknown): string {
  if (!err) return "Something went wrong. Please try again.";

  const message =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : String(err);

  // Zod validation errors (serialized JSON array)
  if (message.startsWith("[") || message.includes('"code":')) {
    try {
      const parsed = JSON.parse(message);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed
          .map((issue: any) => {
            const field = issue.path?.join(".") || "input";
            const label = field.charAt(0).toUpperCase() + field.slice(1);
            return `${label}: ${issue.message}`;
          })
          .join(", ");
      }
    } catch (_) {}
    return "Please check that all fields are filled out correctly.";
  }

  // Auth / permission errors
  if (message.includes("Unauthorized") || message.includes("Forbidden")) {
    return "You don't have permission to do this. Please contact your admin.";
  }
  if (message.includes("Invalid credentials") || message.includes("invalid_credentials")) {
    return "Incorrect username or password. Please check and try again.";
  }
  if (message.includes("session") || message.includes("not authenticated")) {
    return "Your session has expired. Please log in again.";
  }

  // Username / account errors
  if (message.includes("already taken") || message.includes("already exists") || message.includes("duplicate key")) {
    return "This username is already taken. Please choose a different one.";
  }
  if (message.includes("password is too short") || message.includes("Password should be")) {
    return "Your password must be at least 8 characters long.";
  }
  if (message.includes("is already in the list")) {
    return "This email is already in your backup list.";
  }
  if (message.includes("maximum of 3") || message.includes("max(3)")) {
    return "You can configure a maximum of 3 backup email addresses.";
  }
  if (message.includes("No backup emails")) {
    return "Please save at least one backup email address first.";
  }

  // Database errors  
  if (message.includes("backup_emails") || message.includes("logo_url") || (message.includes("column") && message.includes("does not exist"))) {
    return "Database columns are missing. Please execute the SQL script in your Supabase SQL Editor: ALTER TABLE agencies ADD COLUMN IF NOT EXISTS logo_url text; ALTER TABLE agencies ADD COLUMN IF NOT EXISTS backup_emails text[];";
  }
  if (message.includes("PGRST") || message.includes("relation") || message.includes("column")) {
    return "A database error occurred. Please refresh the page and try again.";
  }
  if (message.includes("network") || message.includes("fetch") || message.toLowerCase().includes("failed to fetch")) {
    return "Network connection issue. Please check your internet and try again.";
  }

  // Resend email errors
  if (message.includes("You can only send testing emails to")) {
    const match = message.match(/testing emails to your own email address \(([^)]+)\)/);
    const ownerEmail = match ? match[1] : "your registered email";
    return `Resend Sandbox Limit: You can only send test emails to your verified Resend account email (${ownerEmail}). To send to other email addresses, you must verify your custom domain on Resend.com.`;
  }
  if (message.includes("Resend") || message.includes("resend") || message.includes("validation_error")) {
    return "Could not send the email. Ensure you are sending only to your registered Resend email address, or check your Resend configuration.";
  }

  // Generic user-facing messages
  if (message.includes("not found")) {
    return "The requested record was not found. Please refresh the page.";
  }
  if (message.includes("User not found in your agency")) {
    return "This user is not part of your agency.";
  }

  // If the message is already reasonably short and readable, return it directly
  if (message.length < 120 && !message.includes("Error:") && !message.includes("at ")) {
    return message;
  }

  return "Something went wrong. Please try again or contact support.";
}
