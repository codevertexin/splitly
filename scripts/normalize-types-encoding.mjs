import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const typesPath = path.join(__dirname, '..', 'src', 'types.ts');

const aliasBlock = `

/** App row aliases (re-exported from dbAliases.ts). */
export type Group = Tables<'groups'>
export type Expense = Tables<'expenses'>
export type Event = Tables<'events'>
export type Profile = Tables<'profiles'>
export type EventParticipant = Tables<'event_participants'>
export type UserContact = Tables<'user_contacts'>
`;

const buf = fs.readFileSync(typesPath);
let text = buf.toString('utf16le').replace(/^\uFEFF/, '').replace(/\0/g, '');

text = text.replace(
  /\r?\n\/\*\* (?:Convenience|App) row aliases[\s\S]*export type UserContact = Tables<'user_contacts'>\r?\n/g,
  '\n',
);

if (!text.includes("export type Group = Tables<'groups'>")) {
  text = text.trimEnd() + aliasBlock;
}

fs.writeFileSync(typesPath, text, 'utf8');
const verify = fs.readFileSync(typesPath);
if (verify[0] !== 'e'.charCodeAt(0) || verify[1] !== 'x'.charCodeAt(0)) {
  console.error('normalize-types-encoding: unexpected output encoding');
  process.exit(1);
}
console.log('Wrote UTF-8', typesPath, verify.length, 'bytes');
