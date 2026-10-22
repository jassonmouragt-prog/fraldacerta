import { randomBytes, scryptSync } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

if (!process.stdin.isTTY || !process.stdout.isTTY || !process.stdin.setRawMode) {
  process.stderr.write("Execute este comando em um terminal interativo.\n");
  process.exit(1);
}

function hiddenPrompt(label) {
  return new Promise((resolveInput, reject) => {
    let value = "";
    process.stdout.write(label);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    const finish = (error) => {
      process.stdin.off("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
      if (error) reject(error);
      else resolveInput(value);
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\r" || character === "\n") { finish(); return; }
        if (character === "\u0003") { finish(new Error("Cancelado.")); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else if (character >= " ") value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

try {
  const password = await hiddenPrompt("Nova senha administrativa (mínimo 16 caracteres): ");
  const confirmation = await hiddenPrompt("Confirme a senha: ");
  if (password.length < 16 || password !== confirmation) throw new Error("A senha deve ter pelo menos 16 caracteres e coincidir com a confirmação.");
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, Buffer.from(salt, "hex"), 64).toString("hex");
  const secret = randomBytes(32).toString("hex");
  const path = resolve(process.cwd(), ".env.local");
  let current = "";
  try { current = readFileSync(path, "utf8"); } catch (error) { if (error.code !== "ENOENT") throw error; }
  const names = new Set(["ADMIN_PASSWORD_SALT", "ADMIN_PASSWORD_HASH", "ADMIN_SESSION_SECRET"]);
  const preserved = current.split(/\r?\n/).filter((line) => !names.has(line.split("=", 1)[0]));
  while (preserved.at(-1) === "") preserved.pop();
  preserved.push(`ADMIN_PASSWORD_SALT=${salt}`, `ADMIN_PASSWORD_HASH=${hash}`, `ADMIN_SESSION_SECRET=${secret}`);
  writeFileSync(path, `${preserved.join("\n")}\n`, { encoding: "utf8", mode: 0o600 });
  process.stdout.write("Credenciais administrativas configuradas em .env.local. Sessões anteriores foram invalidadas.\n");
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : "Falha na configuração."}\n`);
  process.exitCode = 1;
}
