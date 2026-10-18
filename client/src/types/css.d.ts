// Global stylesheets are imported for their side effects (e.g. `import "./globals.css"`).
// TypeScript 6 checks side-effect imports by default (noUncheckedSideEffectImports), and
// Next's own types only declare `*.module.css`, so declare plain `.css` files here.
declare module "*.css";
