# Fonts bundled for generated documents

PDF documents (quotation, contract, purchase order) are rendered on the server by
headless Chrome. The fonts are embedded as data URIs by `src/lib/docs/brand.js`, so a
document looks the same on any machine and never waits on a font CDN.

| File | Family | Used for | Source |
|---|---|---|---|
| `poppins-latin-{400,500,600,700}.woff2` | Poppins | Latin text (the brand typeface) | `@fontsource/poppins` 5.x |
| `cairo-arabic-wght.woff2`, `cairo-latin-wght.woff2` | Cairo (variable, 200–1000) | Arabic text, and Latin digits inside Arabic runs | `@fontsource-variable/cairo` 5.x |

Both families are licensed under the SIL Open Font License 1.1
(<https://openfontlicense.org>): free to use, embed and redistribute, as long as the
fonts are not sold on their own.

To refresh them: `npm pack @fontsource/poppins @fontsource-variable/cairo`, unpack, and
copy the same-named `files/*.woff2`.
