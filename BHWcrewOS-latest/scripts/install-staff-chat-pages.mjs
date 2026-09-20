// Mechanical inclusion on staff-owned pages only. The launcher still requires a CrewOS session.
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";
const root = fileURLToPath(new URL("../", import.meta.url));
const marker = '<script src="/staff-chat-launcher.js" defer></script>';
const files = [...(await readdir(root)).filter((name) => name.endsWith(".html")).map((name) => join(root, name)), ...(await readdir(join(root, "provider"))).filter((name) => name.endsWith(".html")).map((name) => join(root, "provider", name))];
let covered = 0;
for (const file of files) {
  const source = await readFile(file, "utf8");
  if (!/crew-provider-gate|bhw-alert-center|crewos_token/.test(source) && !["hq.html", "bhw-staff-guide.html"].includes(basename(file))) continue;
  if (basename(file).startsWith("staff-chat")) continue;
  if (!source.includes(marker)) {
    if (!/<\/body>/i.test(source)) throw new Error(`No body in ${file}`);
    await writeFile(file, source.replace(/<\/body>/i, `${marker}\n</body>`));
  }
  covered += 1;
}
console.log(`Staff Chat launcher present on ${covered} staff pages. Public/patient templates left unchanged.`);
