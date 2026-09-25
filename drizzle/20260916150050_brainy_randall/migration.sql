CREATE TABLE `flux_kontext_edit_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`comfy_prompt_id` text NOT NULL CONSTRAINT `flux_kontext_edit_jobs_comfy_prompt_id_unique` UNIQUE,
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
	CONSTRAINT `fk_flux_kontext_edit_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT "flux_kontext_edit_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "flux_kontext_edit_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "flux_kontext_edit_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX `flux_kontext_edit_jobs_user_created_at` ON `flux_kontext_edit_jobs` (`user_id`,"created_at" desc);