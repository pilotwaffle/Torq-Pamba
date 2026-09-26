"use server";

import { redirect } from "next/navigation";
import { AuthError, loginAccount, signupAccount } from "./account";
import { authHref, safeNext } from "./redirects";
import { createSession, destroySession } from "./session";

function field(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}

export async function signupAction(formData: FormData) {
  const nextPath = safeNext(field(formData, "next"));
  let userId = "";
  try {
    const result = await signupAccount({
      email: field(formData, "email"),
      password: field(formData, "password"),
      workspaceName: field(formData, "workspaceName"),
    });
    userId = result.user.id;
  } catch (error) {
    const message = error instanceof AuthError ? error.message : "Could not create the account";
    redirect(authHref("/signup", nextPath, message));
  }
  await createSession(userId);
  redirect(nextPath);
}

export async function loginAction(formData: FormData) {
  const nextPath = safeNext(field(formData, "next"));
  const user = await loginAccount(field(formData, "email"), field(formData, "password"));
  if (!user) {
    redirect(authHref("/login", nextPath, "Invalid email or password"));
  }
  await createSession(user.id);
  redirect(nextPath);
}

export async function logoutAction() {
  await destroySession();
  redirect("/");
}
