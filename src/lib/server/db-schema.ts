/*
 * Copyright (c) 2026 Cadbos company. All rights reserved.
 *
 * SPDX-License-Identifier: LicenseRef-Cadbos-BSL-1.1
 *
 * Cadbos Interior Design AI is licensed under the Business Source License 1.1.
 * Access is limited to automated analysis tools for analysis of this repository.
 * This code is not open for contribution or usage except under a separate
 * written agreement with Cadbos company.
 *
 * Commercial use in Interior Design & AEC Generative AI Services is prohibited
 * before the Change Date. See LICENSE for complete terms.
 */

import { desc, sql } from 'drizzle-orm';
import {
	check,
	index,
	integer,
	primaryKey,
	real,
	sqliteTable,
	text,
	unique,
	uniqueIndex,
	type AnySQLiteColumn
} from 'drizzle-orm/sqlite-core';

export const users = sqliteTable(
	'users',
	{
		id: text('id'),
		pubkey: text('pubkey').notNull(),
		firstName: text('first_name'),
		lastName: text('last_name'),
		createdAt: integer('created_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.id] }), unique('users_pubkey_unique').on(table.pubkey)]
);

export const sessions = sqliteTable(
	'sessions',
	{
		id: text('id'),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		createdAt: integer('created_at').notNull(),
		expiresAt: integer('expires_at').notNull(),
		userAgent: text('user_agent')
	},
	(table) => [primaryKey({ columns: [table.id] }), index('sessions_expires_at').on(table.expiresAt)]
);

export const authChallenges = sqliteTable(
	'auth_challenges',
	{
		nonce: text('nonce'),
		pubkey: text('pubkey').notNull(),
		createdAt: integer('created_at').notNull(),
		usedAt: integer('used_at')
	},
	(table) => [
		primaryKey({ columns: [table.nonce] }),
		index('auth_challenges_created_at').on(table.createdAt)
	]
);

export const rateLimits = sqliteTable(
	'rate_limits',
	{
		bucket: text('bucket'),
		count: integer('count').notNull(),
		resetAt: integer('reset_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.bucket] })]
);

export const balances = sqliteTable(
	'balances',
	{
		userId: text('user_id').references(() => users.id),
		balance: real('balance').notNull(),
		updatedAt: integer('updated_at').notNull()
	},
	(table) => [primaryKey({ columns: [table.userId] })]
);

export const credits = sqliteTable(
	'credits',
	{
		userId: text('user_id').references(() => users.id),
		balance: real('balance').notNull(),
		updatedAt: integer('updated_at').notNull(),
		enabled: integer('enabled').default(1).notNull()
	},
	(table) => [primaryKey({ columns: [table.userId] })]
);

export const projects = sqliteTable(
	'projects',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		title: text('title').default('').notNull(),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		archivedAt: integer('archived_at')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('projects_user_updated_at').on(table.userId, desc(table.updatedAt))
	]
);

export const projectSessions = sqliteTable(
	'project_sessions',
	{
		id: text('id').notNull(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		title: text('title').default('').notNull(),
		parentSessionId: text('parent_session_id').references(
			(): AnySQLiteColumn => projectSessions.id
		),
		forkedFromGenerationId: text('forked_from_generation_id').references(
			(): AnySQLiteColumn => generations.id
		),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		archivedAt: integer('archived_at')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('project_sessions_project_updated_at').on(table.projectId, desc(table.updatedAt)),
		check(
			'project_sessions_fork_lineage',
			sql`(${table.parentSessionId} IS NULL AND ${table.forkedFromGenerationId} IS NULL) OR (${table.parentSessionId} IS NOT NULL AND ${table.forkedFromGenerationId} IS NOT NULL)`
		)
	]
);

export const projectShares = sqliteTable(
	'project_shares',
	{
		token: text('token').notNull(),
		projectId: text('project_id')
			.notNull()
			.references(() => projects.id),
		createdAt: integer('created_at').notNull(),
		revokedAt: integer('revoked_at')
	},
	(table) => [
		primaryKey({ columns: [table.token] }),
		index('project_shares_project_id').on(table.projectId)
	]
);

export const buckets = sqliteTable(
	'buckets',
	{
		id: integer('id').notNull().primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		url: text('url').notNull(),
		memo: text('memo'),
		region: text('region').default('auto').notNull()
	},
	(table) => [
		uniqueIndex('buckets_name').on(table.name),
		unique('buckets_url_unique').on(table.url)
	]
);

export const media = sqliteTable(
	'media',
	{
		id: integer('id').notNull().primaryKey({ autoIncrement: true }),
		filename: text('filename').notNull(),
		bucket: integer('bucket')
			.notNull()
			.references(() => buckets.id),
		checksum: text('checksum').notNull()
	},
	(table) => [
		unique('media_bucket_filename_unique').on(table.bucket, table.filename),
		index('media_checksum').on(table.checksum),
		check(
			'media_checksum_format',
			sql`${table.checksum} = '' OR (length(${table.checksum}) = 64 AND ${table.checksum} NOT GLOB '*[^0-9a-f]*')`
		)
	]
);

export const generations = sqliteTable(
	'generations',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		resultMediaId: integer('result_media_id')
			.notNull()
			.references(() => media.id),
		sourceMediaId: integer('source_media_id')
			.notNull()
			.references(() => media.id),
		prompt: text('prompt').notNull(),
		kind: text('kind').notNull(),
		amount: real('amount').notNull(),
		balanceAfter: real('balance_after').notNull(),
		createdAt: integer('created_at').notNull(),
		sessionId: text('session_id').references((): AnySQLiteColumn => projectSessions.id),
		comfyuiUploadQueueSec: integer('comfyui_upload_queue_sec').notNull().default(0),
		comfyuiQueueWaitSec: integer('comfyui_queue_wait_sec').notNull().default(0),
		comfyuiExecutionSec: integer('comfyui_execution_sec').notNull().default(0),
		comfyuiDownloadSec: integer('comfyui_download_sec').notNull().default(0),
		comfyuiReuploadSec: integer('comfyui_reupload_sec').notNull().default(0),
		archaiRenderSec: integer('archai_render_sec').notNull().default(0),
		archaiDownloadSec: integer('archai_download_sec').notNull().default(0),
		archaiReuploadSec: integer('archai_reupload_sec').notNull().default(0),
		formSnapshot: text('form_snapshot')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		index('generations_user_created_at').on(table.userId, desc(table.createdAt)),
		index('generations_user_source_media').on(table.userId, table.sourceMediaId, table.createdAt),
		index('generations_session_id').on(table.sessionId, desc(table.createdAt)),
		check(
			'generations_comfyui_upload_queue_sec_positive',
			sql`${table.comfyuiUploadQueueSec} >= 0`
		),
		check('generations_comfyui_queue_wait_sec_positive', sql`${table.comfyuiQueueWaitSec} >= 0`),
		check('generations_comfyui_execution_sec_positive', sql`${table.comfyuiExecutionSec} >= 0`),
		check('generations_comfyui_download_sec_positive', sql`${table.comfyuiDownloadSec} >= 0`),
		check('generations_comfyui_reupload_sec_positive', sql`${table.comfyuiReuploadSec} >= 0`),
		check('generations_archai_render_sec_positive', sql`${table.archaiRenderSec} >= 0`),
		check('generations_archai_download_sec_positive', sql`${table.archaiDownloadSec} >= 0`),
		check('generations_archai_reupload_sec_positive', sql`${table.archaiReuploadSec} >= 0`)
	]
);

export const objectReplacementJobs = sqliteTable(
	'object_replacement_jobs',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		comfyPromptId: text('comfy_prompt_id').notNull(),
		sceneMediaId: integer('scene_media_id')
			.notNull()
			.references(() => media.id),
		referenceMediaId: integer('reference_media_id')
			.notNull()
			.references(() => media.id),
		replacementObject: text('replacement_object').notNull(),
		cost: real('cost').notNull(),
		status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull(),
		outputMediaId: integer('output_media_id').references(() => media.id),
		errorCode: text('error_code'),
		balanceAfter: real('balance_after'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		completedAt: integer('completed_at'),
		sessionId: text('session_id').references(() => projectSessions.id),
		uploadQueueSec: integer('upload_queue_sec').notNull().default(0),
		queueWaitSec: integer('queue_wait_sec').notNull().default(0),
		executionSec: integer('execution_sec').notNull().default(0),
		downloadSec: integer('download_sec').notNull().default(0),
		reuploadSec: integer('reupload_sec').notNull().default(0),
		formSnapshot: text('form_snapshot')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		unique('object_replacement_jobs_comfy_prompt_id_unique').on(table.comfyPromptId),
		index('object_replacement_jobs_user_created_at').on(table.userId, desc(table.createdAt)),
		check('object_replacement_jobs_cost_positive', sql`${table.cost} > 0`),
		check(
			'object_replacement_jobs_status_valid',
			sql`${table.status} IN ('processing', 'completed', 'failed')`
		),
		check(
			'object_replacement_jobs_status_fields',
			sql`(${table.status} = 'processing' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.outputMediaId} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NOT NULL)`
		),
		check('object_replacement_jobs_upload_queue_sec_positive', sql`${table.uploadQueueSec} >= 0`),
		check('object_replacement_jobs_queue_wait_sec_positive', sql`${table.queueWaitSec} >= 0`),
		check('object_replacement_jobs_execution_sec_positive', sql`${table.executionSec} >= 0`),
		check('object_replacement_jobs_download_sec_positive', sql`${table.downloadSec} >= 0`),
		check('object_replacement_jobs_reupload_sec_positive', sql`${table.reuploadSec} >= 0`)
	]
);

export const textureReplacementJobs = sqliteTable(
	'texture_replacement_jobs',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		comfyPromptId: text('comfy_prompt_id').notNull(),
		sceneMediaId: integer('scene_media_id')
			.notNull()
			.references(() => media.id),
		referenceMediaId: integer('reference_media_id')
			.notNull()
			.references(() => media.id),
		replacementSurface: text('replacement_surface').notNull(),
		cost: real('cost').notNull(),
		status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull(),
		outputMediaId: integer('output_media_id').references(() => media.id),
		errorCode: text('error_code'),
		balanceAfter: real('balance_after'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		completedAt: integer('completed_at'),
		sessionId: text('session_id').references(() => projectSessions.id),
		uploadQueueSec: integer('upload_queue_sec').notNull().default(0),
		queueWaitSec: integer('queue_wait_sec').notNull().default(0),
		executionSec: integer('execution_sec').notNull().default(0),
		downloadSec: integer('download_sec').notNull().default(0),
		reuploadSec: integer('reupload_sec').notNull().default(0),
		formSnapshot: text('form_snapshot')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		unique('texture_replacement_jobs_comfy_prompt_id_unique').on(table.comfyPromptId),
		index('texture_replacement_jobs_user_created_at').on(table.userId, desc(table.createdAt)),
		check('texture_replacement_jobs_cost_positive', sql`${table.cost} > 0`),
		check(
			'texture_replacement_jobs_status_valid',
			sql`${table.status} IN ('processing', 'completed', 'failed')`
		),
		check(
			'texture_replacement_jobs_status_fields',
			sql`(${table.status} = 'processing' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.outputMediaId} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NOT NULL)`
		),
		check('texture_replacement_jobs_upload_queue_sec_positive', sql`${table.uploadQueueSec} >= 0`),
		check('texture_replacement_jobs_queue_wait_sec_positive', sql`${table.queueWaitSec} >= 0`),
		check('texture_replacement_jobs_execution_sec_positive', sql`${table.executionSec} >= 0`),
		check('texture_replacement_jobs_download_sec_positive', sql`${table.downloadSec} >= 0`),
		check('texture_replacement_jobs_reupload_sec_positive', sql`${table.reuploadSec} >= 0`)
	]
);

export const lightSettingsJobs = sqliteTable(
	'light_settings_jobs',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		comfyPromptId: text('comfy_prompt_id').notNull(),
		sceneMediaId: integer('scene_media_id')
			.notNull()
			.references(() => media.id),
		sessionId: text('session_id').references(() => projectSessions.id),
		instruction: text('instruction').notNull(),
		cost: real('cost').notNull(),
		status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull(),
		outputMediaId: integer('output_media_id').references(() => media.id),
		errorCode: text('error_code'),
		balanceAfter: real('balance_after'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		completedAt: integer('completed_at'),
		uploadQueueSec: integer('upload_queue_sec').notNull().default(0),
		queueWaitSec: integer('queue_wait_sec').notNull().default(0),
		executionSec: integer('execution_sec').notNull().default(0),
		downloadSec: integer('download_sec').notNull().default(0),
		reuploadSec: integer('reupload_sec').notNull().default(0),
		formSnapshot: text('form_snapshot')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		unique('light_settings_jobs_comfy_prompt_id_unique').on(table.comfyPromptId),
		index('light_settings_jobs_user_created_at').on(table.userId, desc(table.createdAt)),
		check('light_settings_jobs_cost_positive', sql`${table.cost} > 0`),
		check(
			'light_settings_jobs_status_valid',
			sql`${table.status} IN ('processing', 'completed', 'failed')`
		),
		check(
			'light_settings_jobs_status_fields',
			sql`(${table.status} = 'processing' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.outputMediaId} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NOT NULL)`
		),
		check('light_settings_jobs_upload_queue_sec_positive', sql`${table.uploadQueueSec} >= 0`),
		check('light_settings_jobs_queue_wait_sec_positive', sql`${table.queueWaitSec} >= 0`),
		check('light_settings_jobs_execution_sec_positive', sql`${table.executionSec} >= 0`),
		check('light_settings_jobs_download_sec_positive', sql`${table.downloadSec} >= 0`),
		check('light_settings_jobs_reupload_sec_positive', sql`${table.reuploadSec} >= 0`)
	]
);

export const fluxKontextEditJobs = sqliteTable(
	'flux_kontext_edit_jobs',
	{
		id: text('id').notNull(),
		userId: text('user_id')
			.notNull()
			.references(() => users.id),
		comfyPromptId: text('comfy_prompt_id').notNull(),
		sceneMediaId: integer('scene_media_id')
			.notNull()
			.references(() => media.id),
		sessionId: text('session_id').references(() => projectSessions.id),
		instruction: text('instruction').notNull(),
		cost: real('cost').notNull(),
		status: text('status', { enum: ['processing', 'completed', 'failed'] }).notNull(),
		outputMediaId: integer('output_media_id').references(() => media.id),
		errorCode: text('error_code'),
		balanceAfter: real('balance_after'),
		createdAt: integer('created_at').notNull(),
		updatedAt: integer('updated_at').notNull(),
		completedAt: integer('completed_at'),
		uploadQueueSec: integer('upload_queue_sec').notNull().default(0),
		queueWaitSec: integer('queue_wait_sec').notNull().default(0),
		executionSec: integer('execution_sec').notNull().default(0),
		downloadSec: integer('download_sec').notNull().default(0),
		reuploadSec: integer('reupload_sec').notNull().default(0),
		formSnapshot: text('form_snapshot')
	},
	(table) => [
		primaryKey({ columns: [table.id] }),
		unique('flux_kontext_edit_jobs_comfy_prompt_id_unique').on(table.comfyPromptId),
		index('flux_kontext_edit_jobs_user_created_at').on(table.userId, desc(table.createdAt)),
		check('flux_kontext_edit_jobs_cost_positive', sql`${table.cost} > 0`),
		check(
			'flux_kontext_edit_jobs_status_valid',
			sql`${table.status} IN ('processing', 'completed', 'failed')`
		),
		check(
			'flux_kontext_edit_jobs_status_fields',
			sql`(${table.status} = 'processing' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NULL) OR (${table.status} = 'completed' AND ${table.outputMediaId} IS NOT NULL AND ${table.errorCode} IS NULL AND ${table.balanceAfter} IS NOT NULL AND ${table.completedAt} IS NOT NULL) OR (${table.status} = 'failed' AND ${table.outputMediaId} IS NULL AND ${table.errorCode} IS NOT NULL AND ${table.balanceAfter} IS NULL AND ${table.completedAt} IS NOT NULL)`
		),
		check('flux_kontext_edit_jobs_upload_queue_sec_positive', sql`${table.uploadQueueSec} >= 0`),
		check('flux_kontext_edit_jobs_queue_wait_sec_positive', sql`${table.queueWaitSec} >= 0`),
		check('flux_kontext_edit_jobs_execution_sec_positive', sql`${table.executionSec} >= 0`),
		check('flux_kontext_edit_jobs_download_sec_positive', sql`${table.downloadSec} >= 0`),
		check('flux_kontext_edit_jobs_reupload_sec_positive', sql`${table.reuploadSec} >= 0`)
	]
);
