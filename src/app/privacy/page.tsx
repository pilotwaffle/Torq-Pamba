import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";

export const metadata: Metadata = { title: "Privacy Policy" };

const sections: { title: string; paragraphs: string[]; list?: string[] }[] = [
  {
    title: "Data we collect",
    paragraphs: [
      "We collect the information needed to run a workspace. In the default mock mode, video and language providers are not called and receive none of this data.",
    ],
    list: [
      "Account: email address, a scrypt password hash, and an httpOnly session cookie named tp_session",
      "Workspace: name, timezone, plan, monthly budget cap, and the AI-disclosure default",
      "Brand brief: company, niche, products, audience, tone, and the website URL you supplied",
      "Assets you import or upload, the source snippet they came from, and your rights confirmation",
      "Chat messages, video plans, approval choices, schedules, and the audit log",
      "Billing: the plan name and, when Stripe is enabled, a Stripe customer id",
    ],
  },
  {
    title: "Website onboarding fetch",
    paragraphs: [
      "If you give us a website URL during onboarding, the server fetches that page over http or https. The request times out after 8 seconds and stops after 1.5 MB.",
      "We store the fields we extract (such as the company name, what the company does, products, audience, tone, and image URLs) together with the source snippet each field came from. You can edit every field. You can skip the fetch and type the brief yourself.",
      "In production we do not fetch private or local network addresses unless ALLOW_LOCAL_ONBOARDING is set. Outside production, local fetches are allowed so the built-in demo site can be onboarded.",
    ],
  },
  {
    title: "Provider sub-processors",
    paragraphs: [
      "A provider is called only when that provider is enabled: PROVIDER_MODE=live and that vendor's key is set, or, for Stripe, when a test secret key is set. Otherwise we use the mock provider or simulated billing and send them nothing.",
    ],
    list: [
      "Google (Gemini and Veo), only when enabled",
      "xAI, only when enabled",
      "Runway, only when enabled",
      "Kling, only when enabled",
      "HeyGen, only when enabled",
      "ElevenLabs, only when enabled",
      "Anthropic, only when enabled",
      "Stripe, only when enabled",
    ],
  },
  {
    title: "OAuth token handling",
    paragraphs: [
      "This phase does not connect TikTok, Instagram, or Facebook, and it does not store OAuth tokens.",
      "Phase 2, if it ships, will request official OAuth after app review. Tokens would be stored for that workspace, used only to call the platform's official API on your instruction, and deleted when you disconnect the account or the workspace is deleted. We do not sell tokens, and we do not use them to post from devices.",
    ],
  },
  {
    title: "Retention",
    paragraphs: [
      "Account and workspace data are kept while the workspace exists. The audit log is kept with the workspace so there is a record of approvals, label changes, schedule changes, and plan changes.",
      "Generation records stay with the video they belong to. Session rows are removed when they expire or when you log out.",
    ],
  },
  {
    title: "Deletion",
    paragraphs: [
      "You can ask the operator to delete a workspace. Deletion removes that workspace's brief, assets, avatars, chat, videos, schedule, members, invites, and audit log.",
      "Your user account can be closed on request when it no longer belongs to a workspace you want to keep. Backups, if the operator keeps any, are removed within 30 days of that deletion.",
    ],
  },
  {
    title: "Children",
    paragraphs: [
      "Torq-Pamba is not directed at children under 13, and we do not knowingly collect their personal information. If you believe a child has signed up, contact the operator and we will delete the account.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Contact: Torq-Pamba (operator TBD). A contact address will be published before launch. Until then, reach the operator through the project repository. Privacy questions and deletion requests go to that same contact.",
    ],
  },
];

export default function PrivacyPage() {
  return (
    <LegalDocument title="Privacy Policy">
      {sections.map((section) => (
        <LegalSection key={section.title} {...section} />
      ))}
    </LegalDocument>
  );
}
