import { defineConfig } from '@hey-api/openapi-ts';

export const heyApiOpenApiConfig = {
	input: 'src/lib/server/myarchitect/openapi-spec.json',
	output: {
		path: 'src/lib/server/myarchitect',
		clean: false
	}
} as const;

export default defineConfig(heyApiOpenApiConfig);
