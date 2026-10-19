// Turns the single-file Vite build into a claude.ai Artifact page.
//
// Artifact pages are written without <html>/<head>/<body> (the host wraps
// them), may only load scripts from a few CDNs, and should load libraries
// rather than inline them. So this keeps the title, the inlined CSS and app
// code, and swaps the bundled React for the pinned cdnjs UMD builds.
import { readFileSync, writeFileSync } from 'node:fs';

const REACT_VERSION = '18.3.1';
const src = readFileSync(new URL('../artifact/build/index.html', import.meta.url), 'utf8');

const title = /<title>([\s\S]*?)<\/title>/.exec(src)?.[1] ?? 'Allot Budget';
const styles = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map((m) => m[1]).join('\n');
const scripts = [...src.matchAll(/<script type="module"[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
const fonts = [...src.matchAll(/<link\s+rel="stylesheet"[^>]*>/g)].map((m) => m[0].replace(/\s+/g, ' '));

if (scripts.length !== 1) throw new Error(`Expected one inlined module script, found ${scripts.length}`);
const app = scripts[0];
if (/<\/script/i.test(app)) throw new Error('The app bundle contains a closing script tag');
if (/from\s*["']react/.test(app)) throw new Error('React was not externalized');

const page = `<title>${title}</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${fonts.join('\n')}
<style>${styles}</style>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/${REACT_VERSION}/umd/react.production.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/${REACT_VERSION}/umd/react-dom.production.min.js"></script>
<div id="root"></div>
<script type="module">${app}</script>
`;

writeFileSync(new URL('../artifact/allot.html', import.meta.url), page);
console.log(`artifact/allot.html written (${(page.length / 1024).toFixed(0)} KB)`);
