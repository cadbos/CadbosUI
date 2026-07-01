import { defineConfig } from '@hey-api/openapi-ts';

export const heyApiOpenApiConfig = {
	input: 'src/lib/server/archai/openapi-spec.json',
	output: {
		path: 'src/lib/server/archai',
		clean: false
	}
} as const;

export default defineConfig(heyApiOpenApiConfig);
