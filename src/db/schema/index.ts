// Tables are grouped by feature. Migration 0001 created every v2 table up
// front; see docs/V2-PLAN.md before adding another migration.
export * from "./enums";
export * from "./core";
export * from "./media";
export * from "./editor";
export * from "./chat";
export * from "./voices";
export * from "./research";
export * from "./credits";
export * from "./publishing";
export * from "./platform";

import type { apiKeys, knowledgeItems } from "./platform";
import type { chatToolCalls, conversations } from "./chat";
import type { creditCharges, creditLedger, creditTopUps, plans } from "./credits";
import type { sceneTakes, videoCaptions, videoHooks, videoScenes } from "./editor";
import type { generationJobs, mediaAssets, videoRenders } from "./media";
import type { postAnalyticsSnapshots, postMetrics, publishAttempts, publishJobs, publishingConnections, socialAccounts } from "./publishing";
import type { ideas, inspirationAccounts, trends, viralPosts } from "./research";
import type { voiceClones, voices } from "./voices";

export type MediaAsset = typeof mediaAssets.$inferSelect;
export type GenerationJob = typeof generationJobs.$inferSelect;
export type VideoRender = typeof videoRenders.$inferSelect;
export type VideoScene = typeof videoScenes.$inferSelect;
export type SceneTake = typeof sceneTakes.$inferSelect;
export type VideoCaption = typeof videoCaptions.$inferSelect;
export type VideoHook = typeof videoHooks.$inferSelect;
export type Conversation = typeof conversations.$inferSelect;
export type ChatToolCall = typeof chatToolCalls.$inferSelect;
export type Voice = typeof voices.$inferSelect;
export type VoiceClone = typeof voiceClones.$inferSelect;
export type InspirationAccount = typeof inspirationAccounts.$inferSelect;
export type ViralPost = typeof viralPosts.$inferSelect;
export type Trend = typeof trends.$inferSelect;
export type Idea = typeof ideas.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type CreditLedgerEntry = typeof creditLedger.$inferSelect;
export type CreditTopUp = typeof creditTopUps.$inferSelect;
export type CreditCharge = typeof creditCharges.$inferSelect;
export type PublishingConnection = typeof publishingConnections.$inferSelect;
export type PublishAttempt = typeof publishAttempts.$inferSelect;
export type PostAnalyticsSnapshot = typeof postAnalyticsSnapshots.$inferSelect;
export type KnowledgeItem = typeof knowledgeItems.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type SocialAccount = typeof socialAccounts.$inferSelect;
export type PublishJob = typeof publishJobs.$inferSelect;
export type PostMetric = typeof postMetrics.$inferSelect;
