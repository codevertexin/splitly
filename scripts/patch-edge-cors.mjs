import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const functionsDir = path.join(root, 'supabase', 'functions');

function walk(dir, files = []) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) walk(full, files);
    else if (name === 'index.ts') files.push(full);
  }
  return files;
}

const skip = /billing-entitlements|[\\/]_shared[\\/]/;

for (const file of walk(functionsDir)) {
  if (skip.test(file)) continue;
  let c = fs.readFileSync(file, 'utf8');
  if (!c.includes('Access-Control-Allow-Origin": "*"')) continue;

  if (!c.includes('../_shared/cors.ts')) {
    const serveImport = c.match(/^import \{ serve \}[^\n]+\n/m);
    if (serveImport) {
      c = c.replace(serveImport[0], `${serveImport[0]}import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";\n`);
    } else {
      c = `import { corsHeadersForRequest, preflightResponse } from "../_shared/cors.ts";\n${c}`;
    }
  }

  c = c.replace(/const corsHeaders = \{[\s\S]*?\};\n\n?/m, '');
  c = c.replace(
    /function jsonResponse\(body: unknown/g,
    'function jsonResponse(req: Request, body: unknown',
  );
  c = c.replace(/\.\.\.corsHeaders,/g, '...corsHeadersForRequest(req),');
  c = c.replace(
    /if \(req\.method === "OPTIONS"\) \{\s*return new Response\("ok", \{ headers: corsHeaders \}\);\s*\}/g,
    'if (req.method === "OPTIONS") {\n      return preflightResponse(req);\n    }',
  );
  c = c.replace(/return jsonResponse\(/g, 'return jsonResponse(req, ');
  c = c.replace(/return jsonResponse\(req, req,/g, 'return jsonResponse(req,');

  fs.writeFileSync(file, c);
  console.log('patched', path.relative(functionsDir, file));
}
