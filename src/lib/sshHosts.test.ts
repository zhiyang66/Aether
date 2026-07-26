import { beforeEach, describe, expect, it } from "vitest";
import {
  buildSshArgs,
  loadSshHosts,
  parseSshConfig,
  SSH_HOSTS_KEY,
  sshProfiles,
  upsertSshHost,
  type SshHost,
} from "./sshHosts";

beforeEach(() => localStorage.removeItem(SSH_HOSTS_KEY));

const host = (over: Partial<SshHost> = {}): SshHost => ({
  id: "h1",
  name: "prod",
  host: "10.0.0.5",
  ...over,
});

describe("buildSshArgs", () => {
  it("bare host → single target arg", () => {
    expect(buildSshArgs(host())).toEqual(["10.0.0.5"]);
  });

  it("assembles port / identity / jump / extra args, target last", () => {
    const args = buildSshArgs(
      host({
        port: 2222,
        user: "deploy",
        identityFile: "C:\\keys\\id_ed25519",
        jumpHost: "user@bastion",
        extraArgs: ["-o", "ServerAliveInterval=30"],
      }),
    );
    expect(args).toEqual([
      "-p",
      "2222",
      "-i",
      "C:\\keys\\id_ed25519",
      "-J",
      "user@bastion",
      "-o",
      "ServerAliveInterval=30",
      "deploy@10.0.0.5",
    ]);
  });

  it("default port 22 omitted", () => {
    expect(buildSshArgs(host({ port: 22 }))).toEqual(["10.0.0.5"]);
  });
});

describe("parseSshConfig", () => {
  it("parses host blocks with common keys", () => {
    const parsed = parseSshConfig(
      [
        "# comment",
        "Host prod",
        "  HostName 10.0.0.5",
        "  User deploy",
        "  Port 2222",
        '  IdentityFile "~/.ssh/id_prod"',
        "  ProxyJump bastion",
        "",
        "Host *",
        "  ServerAliveInterval 60",
        "Host dev",
        "  HostName dev.local",
      ].join("\n"),
    );
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toMatchObject({
      name: "prod",
      host: "10.0.0.5",
      user: "deploy",
      port: 2222,
      identityFile: "~/.ssh/id_prod",
      jumpHost: "bastion",
    });
    expect(parsed[1]).toMatchObject({ name: "dev", host: "dev.local" });
  });

  it("wildcard-only config yields nothing", () => {
    expect(parseSshConfig("Host *\n  User root")).toEqual([]);
  });
});

describe("sshProfiles", () => {
  it("hosts become ssh-prefixed shell profiles", () => {
    upsertSshHost(host({ user: "root" }));
    expect(loadSshHosts()).toHaveLength(1);
    const profiles = sshProfiles();
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe("ssh:h1");
    expect(profiles[0].shellKey).toBe("ssh:prod");
    expect(profiles[0].path).toBe("ssh");
    expect(profiles[0].args).toEqual(["root@10.0.0.5"]);
  });
});
