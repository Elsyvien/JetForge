# Add advanced workflows when needed

Use impact graphs and fail-closed reference refactors for larger projects. Generated previews identify each line as root-template, include, expression, skeleton, or unmapped output; hover a line or use Go to Definition to inspect its source. Optional IP-XACT discovery, local-XSD intelligence, and validation can be enabled per workspace folder.

`TxtJet: Toggle Generated Preview Provenance Lens` hides or shows the compact `R`/`I`/`E`/`S`/`?` origin markers without changing preview content. Use `TxtJet: Show Source for This Output Line` for the primary origin or `TxtJet: Show All Contributions for This Output Line` when a line combines multiple mappings.

For IP-XACT projects, set `txtjet.ipxact.schemaPaths` to project-owned `.xsd` files or directories. JetForge uses those local schemas to narrow child and attribute completions, show documentation, and navigate to declarations from a template or IP-XACT preview. It never downloads schemas; a configured external validator remains authoritative for full XSD semantics.
