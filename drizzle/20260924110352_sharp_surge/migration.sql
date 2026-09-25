ALTER TABLE `flux_kontext_edit_jobs` ADD `upload_queue_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `flux_kontext_edit_jobs` ADD `queue_wait_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `flux_kontext_edit_jobs` ADD `execution_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `flux_kontext_edit_jobs` ADD `download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `flux_kontext_edit_jobs` ADD `reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `flux_kontext_edit_jobs` ADD `form_snapshot` text;--> statement-breakpoint
ALTER TABLE `generations` ADD `comfyui_upload_queue_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `comfyui_queue_wait_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `comfyui_execution_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `comfyui_download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `comfyui_reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `archai_render_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `archai_download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `archai_reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `generations` ADD `form_snapshot` text;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `upload_queue_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `queue_wait_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `execution_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `light_settings_jobs` ADD `form_snapshot` text;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `upload_queue_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `queue_wait_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `execution_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `object_replacement_jobs` ADD `form_snapshot` text;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `upload_queue_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `queue_wait_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `execution_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `download_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `reupload_sec` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `texture_replacement_jobs` ADD `form_snapshot` text;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_flux_kontext_edit_jobs` (
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
	`upload_queue_sec` integer DEFAULT 0 NOT NULL,
	`queue_wait_sec` integer DEFAULT 0 NOT NULL,
	`execution_sec` integer DEFAULT 0 NOT NULL,
	`download_sec` integer DEFAULT 0 NOT NULL,
	`reupload_sec` integer DEFAULT 0 NOT NULL,
	`form_snapshot` text,
	CONSTRAINT `fk_flux_kontext_edit_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT `fk_flux_kontext_edit_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT "flux_kontext_edit_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "flux_kontext_edit_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "flux_kontext_edit_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "flux_kontext_edit_jobs_upload_queue_sec_positive" CHECK("upload_queue_sec" >= 0),
	CONSTRAINT "flux_kontext_edit_jobs_queue_wait_sec_positive" CHECK("queue_wait_sec" >= 0),
	CONSTRAINT "flux_kontext_edit_jobs_execution_sec_positive" CHECK("execution_sec" >= 0),
	CONSTRAINT "flux_kontext_edit_jobs_download_sec_positive" CHECK("download_sec" >= 0),
	CONSTRAINT "flux_kontext_edit_jobs_reupload_sec_positive" CHECK("reupload_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_flux_kontext_edit_jobs`(`id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `session_id`, `instruction`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`) SELECT `id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `session_id`, `instruction`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at` FROM `flux_kontext_edit_jobs`;--> statement-breakpoint
DROP TABLE `flux_kontext_edit_jobs`;--> statement-breakpoint
ALTER TABLE `__new_flux_kontext_edit_jobs` RENAME TO `flux_kontext_edit_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_generations` (
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
	`comfyui_upload_queue_sec` integer DEFAULT 0 NOT NULL,
	`comfyui_queue_wait_sec` integer DEFAULT 0 NOT NULL,
	`comfyui_execution_sec` integer DEFAULT 0 NOT NULL,
	`comfyui_download_sec` integer DEFAULT 0 NOT NULL,
	`comfyui_reupload_sec` integer DEFAULT 0 NOT NULL,
	`archai_render_sec` integer DEFAULT 0 NOT NULL,
	`archai_download_sec` integer DEFAULT 0 NOT NULL,
	`archai_reupload_sec` integer DEFAULT 0 NOT NULL,
	`form_snapshot` text,
	CONSTRAINT `fk_generations_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_generations_result_media_id_media_id_fk` FOREIGN KEY (`result_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_generations_source_media_id_media_id_fk` FOREIGN KEY (`source_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_generations_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT "generations_comfyui_upload_queue_sec_positive" CHECK("comfyui_upload_queue_sec" >= 0),
	CONSTRAINT "generations_comfyui_queue_wait_sec_positive" CHECK("comfyui_queue_wait_sec" >= 0),
	CONSTRAINT "generations_comfyui_execution_sec_positive" CHECK("comfyui_execution_sec" >= 0),
	CONSTRAINT "generations_comfyui_download_sec_positive" CHECK("comfyui_download_sec" >= 0),
	CONSTRAINT "generations_comfyui_reupload_sec_positive" CHECK("comfyui_reupload_sec" >= 0),
	CONSTRAINT "generations_archai_render_sec_positive" CHECK("archai_render_sec" >= 0),
	CONSTRAINT "generations_archai_download_sec_positive" CHECK("archai_download_sec" >= 0),
	CONSTRAINT "generations_archai_reupload_sec_positive" CHECK("archai_reupload_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_generations`(`id`, `user_id`, `result_media_id`, `source_media_id`, `prompt`, `kind`, `amount`, `balance_after`, `created_at`, `session_id`) SELECT `id`, `user_id`, `result_media_id`, `source_media_id`, `prompt`, `kind`, `amount`, `balance_after`, `created_at`, `session_id` FROM `generations`;--> statement-breakpoint
DROP TABLE `generations`;--> statement-breakpoint
ALTER TABLE `__new_generations` RENAME TO `generations`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_light_settings_jobs` (
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
	`upload_queue_sec` integer DEFAULT 0 NOT NULL,
	`queue_wait_sec` integer DEFAULT 0 NOT NULL,
	`execution_sec` integer DEFAULT 0 NOT NULL,
	`download_sec` integer DEFAULT 0 NOT NULL,
	`reupload_sec` integer DEFAULT 0 NOT NULL,
	`form_snapshot` text,
	CONSTRAINT `fk_light_settings_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_light_settings_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_light_settings_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT `fk_light_settings_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT "light_settings_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "light_settings_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "light_settings_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "light_settings_jobs_upload_queue_sec_positive" CHECK("upload_queue_sec" >= 0),
	CONSTRAINT "light_settings_jobs_queue_wait_sec_positive" CHECK("queue_wait_sec" >= 0),
	CONSTRAINT "light_settings_jobs_execution_sec_positive" CHECK("execution_sec" >= 0),
	CONSTRAINT "light_settings_jobs_download_sec_positive" CHECK("download_sec" >= 0),
	CONSTRAINT "light_settings_jobs_reupload_sec_positive" CHECK("reupload_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_light_settings_jobs`(`id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `session_id`, `instruction`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`) SELECT `id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `session_id`, `instruction`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at` FROM `light_settings_jobs`;--> statement-breakpoint
DROP TABLE `light_settings_jobs`;--> statement-breakpoint
ALTER TABLE `__new_light_settings_jobs` RENAME TO `light_settings_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_object_replacement_jobs` (
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
	`upload_queue_sec` integer DEFAULT 0 NOT NULL,
	`queue_wait_sec` integer DEFAULT 0 NOT NULL,
	`execution_sec` integer DEFAULT 0 NOT NULL,
	`download_sec` integer DEFAULT 0 NOT NULL,
	`reupload_sec` integer DEFAULT 0 NOT NULL,
	`form_snapshot` text,
	CONSTRAINT `fk_object_replacement_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_reference_media_id_media_id_fk` FOREIGN KEY (`reference_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_object_replacement_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT "object_replacement_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "object_replacement_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "object_replacement_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "object_replacement_jobs_upload_queue_sec_positive" CHECK("upload_queue_sec" >= 0),
	CONSTRAINT "object_replacement_jobs_queue_wait_sec_positive" CHECK("queue_wait_sec" >= 0),
	CONSTRAINT "object_replacement_jobs_execution_sec_positive" CHECK("execution_sec" >= 0),
	CONSTRAINT "object_replacement_jobs_download_sec_positive" CHECK("download_sec" >= 0),
	CONSTRAINT "object_replacement_jobs_reupload_sec_positive" CHECK("reupload_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_object_replacement_jobs`(`id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `reference_media_id`, `replacement_object`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`, `session_id`) SELECT `id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `reference_media_id`, `replacement_object`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`, `session_id` FROM `object_replacement_jobs`;--> statement-breakpoint
DROP TABLE `object_replacement_jobs`;--> statement-breakpoint
ALTER TABLE `__new_object_replacement_jobs` RENAME TO `object_replacement_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_texture_replacement_jobs` (
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
	`upload_queue_sec` integer DEFAULT 0 NOT NULL,
	`queue_wait_sec` integer DEFAULT 0 NOT NULL,
	`execution_sec` integer DEFAULT 0 NOT NULL,
	`download_sec` integer DEFAULT 0 NOT NULL,
	`reupload_sec` integer DEFAULT 0 NOT NULL,
	`form_snapshot` text,
	CONSTRAINT `fk_texture_replacement_jobs_user_id_users_id_fk` FOREIGN KEY (`user_id`) REFERENCES `users`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_scene_media_id_media_id_fk` FOREIGN KEY (`scene_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_reference_media_id_media_id_fk` FOREIGN KEY (`reference_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_output_media_id_media_id_fk` FOREIGN KEY (`output_media_id`) REFERENCES `media`(`id`),
	CONSTRAINT `fk_texture_replacement_jobs_session_id_project_sessions_id_fk` FOREIGN KEY (`session_id`) REFERENCES `project_sessions`(`id`),
	CONSTRAINT "texture_replacement_jobs_cost_positive" CHECK("cost" > 0),
	CONSTRAINT "texture_replacement_jobs_status_valid" CHECK("status" IN ('processing', 'completed', 'failed')),
	CONSTRAINT "texture_replacement_jobs_status_fields" CHECK(("status" = 'processing' AND "output_media_id" IS NULL AND "error_code" IS NULL AND "balance_after" IS NULL AND "completed_at" IS NULL) OR ("status" = 'completed' AND "output_media_id" IS NOT NULL AND "error_code" IS NULL AND "balance_after" IS NOT NULL AND "completed_at" IS NOT NULL) OR ("status" = 'failed' AND "output_media_id" IS NULL AND "error_code" IS NOT NULL AND "balance_after" IS NULL AND "completed_at" IS NOT NULL)),
	CONSTRAINT "texture_replacement_jobs_upload_queue_sec_positive" CHECK("upload_queue_sec" >= 0),
	CONSTRAINT "texture_replacement_jobs_queue_wait_sec_positive" CHECK("queue_wait_sec" >= 0),
	CONSTRAINT "texture_replacement_jobs_execution_sec_positive" CHECK("execution_sec" >= 0),
	CONSTRAINT "texture_replacement_jobs_download_sec_positive" CHECK("download_sec" >= 0),
	CONSTRAINT "texture_replacement_jobs_reupload_sec_positive" CHECK("reupload_sec" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_texture_replacement_jobs`(`id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `reference_media_id`, `replacement_surface`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`, `session_id`) SELECT `id`, `user_id`, `comfy_prompt_id`, `scene_media_id`, `reference_media_id`, `replacement_surface`, `cost`, `status`, `output_media_id`, `error_code`, `balance_after`, `created_at`, `updated_at`, `completed_at`, `session_id` FROM `texture_replacement_jobs`;--> statement-breakpoint
DROP TABLE `texture_replacement_jobs`;--> statement-breakpoint
ALTER TABLE `__new_texture_replacement_jobs` RENAME TO `texture_replacement_jobs`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `flux_kontext_edit_jobs_user_created_at` ON `flux_kontext_edit_jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `generations_user_created_at` ON `generations` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `generations_user_source_media` ON `generations` (`user_id`,`source_media_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `generations_session_id` ON `generations` (`session_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `light_settings_jobs_user_created_at` ON `light_settings_jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `object_replacement_jobs_user_created_at` ON `object_replacement_jobs` (`user_id`,"created_at" desc);--> statement-breakpoint
CREATE INDEX `texture_replacement_jobs_user_created_at` ON `texture_replacement_jobs` (`user_id`,"created_at" desc);