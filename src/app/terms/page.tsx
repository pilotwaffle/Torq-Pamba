import type { Metadata } from "next";
import { LegalDocument, LegalSection } from "@/components/legal-document";

export const metadata: Metadata = { title: "Terms of Service" };

const sections: { title: string; paragraphs: string[]; list?: string[] }[] = [
  {
    title: "The service",
    paragraphs: [
      "Torq-Pamba is a studio for making short AI-generated videos for a brand, getting a person to approve them, and placing approved videos on a schedule.",
      "The service publishes only videos you approved, only to TikTok, Instagram, or Facebook accounts you connected, and only through those platforms' official APIs. When a scheduled item has no connected account, it is marked ready for you to publish manually. The product never posts from a device.",
    ],
  },
  {
    title: "Accounts and workspaces",
    paragraphs: [
      "You sign up with an email address and a password. We store the password as a scrypt hash. Signing up creates a workspace. People in a workspace have the role owner, admin, or member.",
      "Owners and admins can invite others. An invite link expires after 14 days. You are responsible for your password and for the people you invite. One person may belong to more than one workspace.",
    ],
  },
  {
    title: "Acceptable use",
    paragraphs: [
      "Use the service for a brand you are allowed to represent, and only with material you have rights to use. The following are prohibited:",
    ],
    list: [
      "Device farms or SIM farms",
      "Account warming",
      "Creating, buying, selling, or transferring social accounts",
      "Ban evasion, including re-creating a banned account",
      "Stripping or altering AI-provenance metadata",
      "Posting from devices, unofficial clients, or automated browsers we control",
      "Unlawful content, impersonation, or content you do not have rights to use",
    ],
  },
  {
    title: "AI-generated content and disclosure",
    paragraphs: [
      "Clips made here are AI-generated. An AI-generated label is on by default for every video. You can see that label on the approval screen.",
      "Turning the label off requires an explicit confirmation, and that choice is written to the workspace audit log. You are responsible for the disclosure rules of any platform where you later publish the video yourself.",
    ],
  },
  {
    title: "User content and rights confirmation",
    paragraphs: [
      "You keep ownership of the briefs, images, scripts, and other material you submit. You grant Torq-Pamba a limited license to host and process that material so we can provide the service.",
      "Before an imported or uploaded asset can be used, you confirm that you have rights to use it. Approval also asks you to confirm music use where the form requires it. Do not upload a likeness, logo, or product you are not allowed to use.",
    ],
  },
  {
    title: "Third-party platforms",
    paragraphs: [
      "TikTok's terms and Meta's terms (including Instagram and Facebook) apply when you use those services. Torq-Pamba is not those companies and does not control their review, reach, or enforcement.",
      "You may connect TikTok, Instagram, or Facebook accounts you own or manage. Connection uses each platform's official OAuth and asks only for the permissions needed to publish and read analytics through their official APIs. Torq-Pamba posts only content you approved, only to accounts you selected, and never posts from devices.",
      "Until TikTok completes its Content Posting audit of this app, TikTok posts are private (Only me) and limited to 5 creators per 24 hours.",
    ],
  },
  {
    title: "Billing",
    paragraphs: [
      "Plan prices are placeholder test-mode prices: Free at $0, Creator at $29 per month, and Studio at $99 per month. They are not a live offer.",
      "When a Stripe test key is configured, paid plans use Stripe Checkout in subscription mode. A live secret key (one that starts with sk_live_) is refused. With no Stripe key, an upgrade is simulated, labeled as simulated, and does not charge a card.",
      "Model generation costs are separate estimates shown before you generate a clip. They are list-price estimates of provider cost, not the subscription, and a failed generation is not recorded as spend.",
    ],
  },
  {
    title: "Termination",
    paragraphs: [
      "You may stop using the service at any time and ask the operator to delete a workspace. We may suspend or close a workspace that breaks these terms, especially the prohibited uses above.",
      "Sections that should survive, including rights you granted only as needed to wind down, disclaimers, and the audit of what was approved, survive for as long as we still hold that record.",
    ],
  },
  {
    title: "Disclaimers",
    paragraphs: [
      "The service is provided as-is. With no provider keys, generation uses a mock provider and the frames are placeholders, not a finished commercial. Cost figures are estimates and can differ from a vendor invoice.",
      "We do not guarantee that a platform will accept a video, that a scheduled item will be posted, or any level of reach. We do not post the video for you.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "Contact: Torq-Pamba (operator TBD). A contact address will be published before launch. Until then, reach the operator through the project repository. Do not send passwords or card numbers.",
    ],
  },
];

export default function TermsPage() {
  return (
    <LegalDocument title="Terms of Service">
      {sections.map((section) => (
        <LegalSection key={section.title} {...section} />
      ))}
    </LegalDocument>
  );
}
