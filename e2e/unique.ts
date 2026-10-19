import type { TestInfo } from '@playwright/test';

/** Tests share one calendar server, so each run's entries get a name no other test or repeat uses. */
export const unique = (label: string, info: TestInfo) =>
	`${label} ${info.project.name}${info.repeatEachIndex}${Math.random().toString(36).slice(2, 6)}`;
