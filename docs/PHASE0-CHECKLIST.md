# Phase 0 checklist

This repo signed up for nothing; a human owner must do these steps.

Phase 0 is the approval groundwork from the research report (section 4E). It runs beside the studio and does not add product code. The public pages already exist in this repository: `/` is more than a login page, and Terms and Privacy are linked in the header and the footer without opening a menu. A person still has to publish that site and open the developer accounts.

Publishing to TikTok, Instagram, or Facebook is Phase 2. None of the boxes below turn on posting inside this repo.

Lead times are the figures those companies publish. Where a page does not publish a duration, the line says unknown.

## Do these first

- [ ] **Publish the public site** on a URL reviewers can open, with Terms and Privacy visible without opening a menu. TikTok’s app review guidelines say the website cannot be only a landing page or a login page, and that the Terms of Service and privacy policy links must be visible without having to open a menu. The pages to publish are `/`, `/terms`, and `/privacy`.
  - Guide: https://developers.tiktok.com/doc/app-review-guidelines
  - Published lead time: none for putting your own site online. TikTok app review, once you later submit the app, is quoted below.

- [ ] **Start Meta business verification.** Advanced Access later depends on a verified business. Meta’s help center says verification may take up to 14 business days.
  - https://www.facebook.com/business/help/2058515294227817
  - Published lead time: "may take up to 14 business days".

- [ ] **Create a TikTok developer account, register an app, and use the sandbox.** TikTok requires the sandbox for first-time demo videos. This repository does not call the Content Posting API. Registration is so a later phase can.
  - Developer portal: https://developers.tiktok.com/
  - Getting started, including app review timing: https://developers.tiktok.com/doc/getting-started-faq
  - Content Posting API, including the audit and unaudited behavior: https://developers.tiktok.com/doc/content-posting-api-get-started
  - Content sharing rules, including unaudited limits and the required posting UX: https://developers.tiktok.com/doc/content-sharing-guidelines
  - Published lead time for TikTok app review (Login Kit and Content Posting scopes): "several days to two weeks after submission" (getting-started FAQ).
  - Published lead time for the Content Posting API audit that lifts private-only mode: unknown. The getting-started page for that API says unaudited clients are restricted and that the client must undergo an audit, and it does not state how long the audit takes.

## Later, before any public posting (Phase 2)

- [ ] **Submit Meta app review** for Advanced Access to the Instagram publishing and insights permissions, and for Facebook Reels, after the integration exists and can record the required screen captures. Meta’s submission guide says you should receive a decision within a week. A separate permissions page says permissions are generally reviewed within 3 business days, some take up to 7 days, and warns that it may take several weeks. The guide also requires a successful API call for each permission within 30 days before submission. Business verification is a prerequisite.
  - Submission guide: https://developers.facebook.com/documentation/resp-plat-initiatives/individual-processes/app-review/submission-guide
  - Permissions review timing: https://developers.facebook.com/docs/facebook-login/guides/permissions/review/
  - Published lead time: "you should receive a decision within a week." Also published: generally within 3 business days, some up to 7 days, and it may take several weeks.

- [ ] **Submit the TikTok app for review, then the Content Posting audit,** only after a human has a working integration to demonstrate. Keep using the sandbox until that review exists.
  - App review: https://developers.tiktok.com/doc/getting-started-faq — "several days to two weeks after submission".
  - Audit: https://developers.tiktok.com/doc/content-posting-api-get-started — duration unknown (not published).
  - A request to raise the active-creator cap is also unknown. The getting-started FAQ says to ask support, the app must be in production, and not all requests will be approved.

## Unaudited limits

These apply to a TikTok client that has not passed the Content Posting audit. They are platform rules for a future Phase 2 client. This repository does not post, so it does not consume the cap.

- Unaudited clients can only post content in `SELF_ONLY` viewership. The content-sharing guidelines and the Content Posting getting-started page both say that content posted by an unaudited client is restricted to private viewing.
- An unaudited API client can allow up to 5 users to post in a 24 hour window, and those accounts must be private at posting time.
  - https://developers.tiktok.com/doc/content-sharing-guidelines
  - https://developers.tiktok.com/doc/content-posting-api-get-started

Direct Post’s everyday per-account cap (the docs say typically around 15 posts per day per creator, shared across API clients) and the per-user rate limit are separate from the unaudited 5-user window. Design around them in Phase 2. Do not treat them as a target volume.
