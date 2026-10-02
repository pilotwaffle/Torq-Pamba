import { getDb } from "@/db";
import { serviceRequests } from "@/db/schema";

/** Done-with-you service leads. Stored only; the app sends no email (see REPORT.md). */

export type ServiceRequestInput = { name: string; email: string; company: string; monthlyVideos: number; message: string; website?: string };

export function validateServiceRequest(input: ServiceRequestInput): string[] {
  const errors: string[] = [];
  if (!input.name.trim() || input.name.trim().length > 80) errors.push("Enter your name");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(input.email.trim()) || input.email.length > 200) errors.push("Enter a valid email");
  if (input.company.length > 120) errors.push("Company name is too long");
  if (!Number.isInteger(input.monthlyVideos) || input.monthlyVideos < 1 || input.monthlyVideos > 1000) errors.push("Videos per month must be 1 to 1000");
  if (input.message.length > 2000) errors.push("Message must be 2000 characters or fewer");
  return errors;
}

/** Returns "stored", or "dropped" when the honeypot field was filled (bots). */
export async function saveServiceRequest(input: ServiceRequestInput): Promise<"stored" | "dropped"> {
  const errors = validateServiceRequest(input);
  if (errors.length > 0) throw new Error(errors[0]);
  if (input.website?.trim()) return "dropped";
  const db = await getDb();
  await db.insert(serviceRequests).values({
    name: input.name.trim(),
    email: input.email.trim().toLowerCase(),
    company: input.company.trim(),
    monthlyVideos: input.monthlyVideos,
    message: input.message.trim(),
  });
  return "stored";
}
