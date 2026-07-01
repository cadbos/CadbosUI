# License Headers

Cadbos source files require a file-level license notice. Add the appropriate
header from this directory whenever creating a source file or modifying a source
file that does not already have one. The license is project-specific, so use
`LicenseRef-Cadbos-BSL-1.1` instead of a plain SPDX license identifier.

The full license terms live in [../../LICENSE](../../LICENSE).

## Header Files

| Header | Purpose | File types |
| --- | --- | --- |
| [block-comment.txt](block-comment.txt) | Default source-code header for languages that support C-style block comments. | `.ts`, `.js`, `.css`, `.scss`, `.sql`, `.jsonc`, `.cjs`, `.mjs` |
| [html-comment.txt](html-comment.txt) | Markup header for files where HTML comments are valid at the top level. | `.svelte`, `.html`, `.svg`, `.xml` |
| [line-comment.txt](line-comment.txt) | Header for formats where block comments are unavailable or inappropriate. | `.sh`, `.yml`, `.yaml`, `.toml`, `.env.example`, extensionless scripts |

Place the header at the top of the file before source code. For executable scripts
with a shebang, keep the shebang as the first line and place
`line-comment.txt` immediately after it.

Do not add these headers to documentation, binary assets, generated files,
lockfiles, vendored third-party files, or files that already carry a different
third-party license notice.
