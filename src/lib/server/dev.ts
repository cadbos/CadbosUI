import { dev } from '$app/environment';
import { error } from '@sveltejs/kit';

// Guards endpoints that only exist while the real integrations are mocked.
// In production these routes respond 404 until phase C replaces them.
export function assertDevOnly(): void {
	if (!dev) error(404);
}
