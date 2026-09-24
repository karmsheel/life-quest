export * from "./types.ts";
export * from "./frontmatter.ts";
export * from "./documents.ts";
export * from "./unlock.ts";
export * from "./paths.ts";
export * from "./atomic-write.ts";
export * from "./log.ts";
export * from "./create-vault.ts";
export * from "./open-vault.ts";
export * from "./domains.ts";
export * from "./domain-documents.ts";
export * from "./decisions.ts";
export * from "./agents.ts";
export * from "./signal-chain.ts";
export * from "./domain-lens.ts";
export * from "./library-documents.ts";
export { applyGoalCommand, applyGoalsCommand, loadGoals } from "./goals.ts";
export { formatGoalPace, goalPace } from "./goal-progress.ts";
export type { GoalPace } from "./goal-progress.ts";

export {
  applyMapCommandPure,
  dashboardDays,
  eventsInMonth,
  eventsOnDate,
  PALETTE,
  COLOR_IDS,
  todayLocalIso,
  yearOf,
  mondayOnOrBefore,
  mondaysInYear,
  daysInMonth,
  findYear,
  liveYears,
  resolveWeek,
} from "./map/public.ts";
export { applyMapCommand, ensureMapOnOpen, loadMapState } from "./map/persist.ts";
export {
  commandForGoalTool,
  commandForTool,
  GOALS_TOOL_DEFS,
  MAP_TOOL_DEFS,
} from "./map/tools.ts";
export type { MapToolDef } from "./map/tools.ts";
export {
  DOCUMENT_TOOL_DEFS,
  executeDocumentTool,
} from "./document-tools.ts";
export {
  REVIEW_TOOL_DEFS,
  executeReviewTool,
} from "./review-tools.ts";
export {
  isReviewCadence,
  isWeekStartDay,
  weekStartOnOrBefore,
  currentPeriod,
  periodBounds,
  previousPeriod,
  nextPeriod,
  isFuturePeriod,
  isCurrentPeriod,
  periodTitle,
} from "./period.ts";
export {
  ensureReview,
  getReview,
  writeReview,
  markReviewDone,
  unlockReview,
  setReviewSessionId,
  listReviewIndex,
  applyLockedReviewBody,
} from "./reviews.ts";
export {
  ensurePlanningStub,
  getPlanningStub,
  setPlanningSessionId,
  listPlanningIndex,
} from "./planning-stubs.ts";
export { getPeriodPack } from "./period-pack.ts";
export {
  createDatabase,
  listDatabases,
  getDatabase,
  addDatabaseColumn,
  listRows,
  getRow,
  upsertRow,
  deleteRow,
  saveDatabaseFile,
  ensureVaultDatabaseGitignore,
  invalidateDomainCache,
} from "./domain-databases.ts";
export {
  listPages,
  getPage,
  createPage,
  updatePage,
  deletePage,
} from "./pages.ts";
export {
  listPins,
  setPins,
  defaultPins,
} from "./pins.ts";
export {
  exportDomainBooks,
  restoreDomainBooks,
} from "./books-export.ts";
export {
  ingestFile,
  proposeMapping,
  listMappings,
  getMapping,
  listIngestBatches,
  listIngestRows,
  editIngestRow,
  acceptIngestRows,
  rejectIngestRows,
  ingestFingerprint,
} from "./ingest.ts";
export {
  linkDatabaseAdapter,
  unlinkDatabaseAdapter,
  syncDatabase,
  syncLinkedDatabases,
  listSyncConflicts,
  resolveSyncConflict,
} from "./adapters.ts";
export {
  installFinanceKit,
  listInstalledKits,
  getFinanceKitSettings,
  applyFinanceKitInstall,
} from "./finance-kit.ts";
export type { MapStoreState, MapCommand, MapActor, MapDomainError, YearRecord, MapEvent, Task, TaskColumn, ColorId, DayType, DetachedWeek, ResolvedWeek } from "./map/public.ts";
