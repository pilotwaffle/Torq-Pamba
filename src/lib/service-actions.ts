"use server";

import { redirect } from "next/navigation";
import { saveServiceRequest, validateServiceRequest, type ServiceRequestInput } from "./service";

function text(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function requestServiceAction(formData: FormData) {
  const input: ServiceRequestInput = {
    name: text(formData, "name"),
    email: text(formData, "email"),
    company: text(formData, "company"),
    monthlyVideos: Number(text(formData, "monthlyVideos")),
    message: text(formData, "message"),
    website: text(formData, "website"),
  };
  const errors = validateServiceRequest(input);
  if (errors.length > 0) redirect(`/done-with-you?error=${encodeURIComponent(errors[0] ?? "Check the form")}#request`);
  await saveServiceRequest(input);
  redirect("/done-with-you?sent=1#request");
}
