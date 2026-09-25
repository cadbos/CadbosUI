CREATE TABLE IF NOT EXISTS `auth_challenges` (
	`nonce` text PRIMARY KEY,
	`pubkey` text NOT NULL,
	`created_at` integer NOT NULL,
	`used_at` integer
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `balances` (
	`user_id` text PRIMARY KEY,
	`balance` real NOT NULL,
	`updated_at` integer NOT NULL,
	CONSTRAINT `fk_balances_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `buckets` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`name` text NOT NULL,
	`url` text NOT NULL CONSTRAINT `buckets_url_unique` UNIQUE,
	`memo` text,
	`region` text DEFAULT 'auto' NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `credits` (
	`user_id` text PRIMARY KEY,
	`balance` real NOT NULL,
	`updated_at` integer NOT NULL,
	`enabled` integer DEFAULT 1 NOT NULL,
	CONSTRAINT `fk_credits_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `generations` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`result_media_id` integer NOT NULL,
	`source_media_id` integer NOT NULL,
	`prompt` text NOT NULL,
	`kind` text NOT NULL,
	`amount` real NOT NULL,
	`balance_after` real NOT NULL,
	`created_at` integer NOT NULL,
	`session_id` text,
	CONSTRAINT `fk_generations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_generations_result_media_id_media_id_fk` FOREIGN KEY (`result_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_generations_source_media_id_media_id_fk` FOREIGN KEY (`source_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_generations_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `light_settings_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comfy_prompt_id` text NOT NULL CONSTRAINT `light_settings_jobs_comfy_prompt_id_unique` UNIQUE,
	`scene_media_id` integer NOT NULL,
	`session_id` text,
	`instruction` text NOT NULL,
	`cost` real NOT NULL,
	`status` text NOT NULL,
	`output_media_id` integer,
	`error_code` text,
	`balance_after` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	CONSTRAINT `fk_light_settings_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_light_settings_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_light_settings_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT `fk_light_settings_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT "light_settings_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "light_settings_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "light_settings_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `media` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`filename` text NOT NULL,
	`bucket` integer NOT NULL,
	`checksum` text NOT NULL,
	CONSTRAINT `fk_media_bucket_buckets_id_fk` FOREIGN KEY (`bucket`) REFERENCES `buckets`(`id`),
	CONSTRAINT `media_bucket_filename_unique` UNIQUE(`bucket`,`filename`),
	CONSTRAINT "media_checksum_format" CHECK("checksum" = '' OR (length("checksum") = 64 AND "checksum" NOT GLOB '*[^0-9a-f]*'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `object_replacement_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comfy_prompt_id` text NOT NULL CONSTRAINT `object_replacement_jobs_comfy_prompt_id_unique` UNIQUE,
	`scene_media_id` integer NOT NULL,
	`reference_media_id` integer NOT NULL,
	`replacement_object` text NOT NULL,
	`cost` real NOT NULL,
	`status` text NOT NULL,
	`output_media_id` integer,
	`error_code` text,
	`balance_after` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`session_id` text,
	CONSTRAINT `fk_object_replacement_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_reference_media_id_media_id_fk` FOREIGN KEY (`reference_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT "object_replacement_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "object_replacement_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "object_replacement_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`parent_session_id` text,
	`forked_from_generation_id` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT `fk_project_sessions_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`),
	CONSTRAINT `fk_project_sessions_parent_session_id_project_sessions_id_fk` FOREIGN KEY (`parent_session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT `fk_project_sessions_forked_from_generation_id_generations_id_fk` FOREIGN KEY (`forked_from_generation_id`) REFERENCES `generations`(`id`),
	CONSTRAINT "project_sessions_fork_lineage" CHECK(("parent_session_id" IS NULL AND "forked_from_generation_id" IS NULL) OR ("parent_session_id" IS NOT NULL AND "forked_from_generation_id" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `project_shares` (
	`token` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`revoked_at` integer,
	CONSTRAINT `fk_project_shares_project_id_projects_id_fk` FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`title` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT `fk_projects_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `rate_limits` (
	`bucket` text PRIMARY KEY,
	`count` integer NOT NULL,
	`reset_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `sessions` (
	`id` text PRIMARY KEY,
	`user_id` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`user_agent` text,
	CONSTRAINT `fk_sessions_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `texture_replacement_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comfy_prompt_id` text NOT NULL CONSTRAINT `texture_replacement_jobs_comfy_prompt_id_unique` UNIQUE,
	`scene_media_id` integer NOT NULL,
	`reference_media_id` integer NOT NULL,
	`replacement_surface` text NOT NULL,
	`cost` real NOT NULL,
	`status` text NOT NULL,
	`output_media_id` integer,
	`error_code` text,
	`balance_after` real,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`completed_at` integer,
	`session_id` text,
	CONSTRAINT `fk_texture_replacement_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_reference_media_id_media_id_fk` FOREIGN KEY (`reference_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT "texture_replacement_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "texture_replacement_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "texture_replacement_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `users` (
	`id` text PRIMARY KEY,
	`pubkey` text NOT NULL CONSTRAINT `users_pubkey_unique` UNIQUE,
	`first_name` text,
	`last_name` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `auth_challenges_created_at` ON `auth_challenges` (`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `buckets_name` ON `buckets` (`name`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `generations_user_created_at` ON `generations` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `generations_user_source_media` ON `generations` (`user_id`,`source_media_id`,`created_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `generations_session_id` ON `generations` (`session_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `light_settings_jobs_user_created_at` ON `light_settings_jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `media_checksum` ON `media` (`checksum`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `object_replacement_jobs_user_created_at` ON `object_replacement_jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_sessions_project_updated_at` ON `project_sessions` (`project_id`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `project_shares_project_id` ON `project_shares` (`project_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `projects_user_updated_at` ON `projects` (`user_id`,"updated_at" desc);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `sessions_expires_at` ON `sessions` (`expires_at`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `texture_replacement_jobs_user_created_at` ON `texture_replacement_jobs` (`user_id`,"created_at" desc);