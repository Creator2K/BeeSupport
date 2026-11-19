import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { z } from "zod";
import { loadModule, auth } from "./load-module.mjs";

const launcher = loadModule("src/lib/launcher.ts");
const brand = loadModule("src/lib/branding.ts", {
  zod: { z },
  "./launcher": launcher,
});
const matching = loadModule("src/lib/risk-matching.ts");
test("branding inheritance preserves false and empty overrides and rejects executable logo URLs", () => {
  const settings = brand.mergeWidgetSettings(
    { title: "平台", imagesEnabled: false },
    { title: "商家" },
    { title: "", filesEnabled: false },
  );
  assert.equal(settings.title, "");
  assert.equal(settings.imagesEnabled, false);
  assert.equal(settings.filesEnabled, false);
  for (const logoUrl of [
    "javascript:alert(1)",
    "data:image/svg+xml,x",
    "https://user:pass@example.com/logo.png",
  ])
    assert.equal(
      brand.widgetSettingsSchema.safeParse({ logoUrl }).success,
      false,
    );
  assert.equal(
    brand.widgetSettingsSchema.safeParse({ title: "a", tenantId: "other" })
      .success,
    false,
  );
});

test("launcher preferences validate allowed styles, bound text and preserve layered inheritance", () => {
  for (const launcherStyle of launcher.LAUNCHER_STYLES)
    assert.equal(
      brand.widgetSettingsSchema.safeParse({ launcherStyle }).success,
      true,
    );
  assert.equal(
    brand.widgetSettingsSchema.safeParse({ launcherStyle: "custom-html" })
      .success,
    false,
  );
  assert.equal(
    brand.widgetSettingsSchema.safeParse({ launcherLabel: "字".repeat(21) })
      .success,
    false,
  );
  const inherited = brand.mergeWidgetSettings(
    { launcherStyle: "pill", launcherLabel: "平台客服" },
    { launcherLabel: "商家客服" },
    { launcherStyle: "outline", launcherLabel: "" },
  );
  assert.equal(inherited.launcherStyle, "outline");
  assert.equal(inherited.launcherLabel, "");
  assert.equal(
    brand.mergeWidgetSettings({ launcherStyle: "pill" }, {}).launcherStyle,
    "pill",
  );
  assert.equal(brand.mergeWidgetSettings().launcherStyle, "bubble");
  assert.equal(brand.mergeWidgetSettings().launcherDraggable, false);
  assert.equal(brand.mergeWidgetSettings({ launcherDraggable: true }, {}).launcherDraggable, true);
  assert.equal(
    brand.mergeWidgetSettings({ launcherDraggable: true }, { launcherDraggable: false }).launcherDraggable,
    false,
  );
});

test("launcher text stays readable across dark, light and saturated merchant colors", () => {
  const luminance = (hex) => {
    const values = hex
      .match(/[a-f0-9]{2}/gi)
      .map((v) => parseInt(v, 16) / 255)
      .map((v) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
    return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
  };
  for (let r = 0; r <= 255; r += 51)
    for (let g = 0; g <= 255; g += 51)
      for (let b = 0; b <= 255; b += 51) {
        const color =
          "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
        for (const kind of launcher.LAUNCHER_STYLES) {
          const appearance = launcher.launcherAppearance(kind, color);
          const values = [
            luminance(appearance.color),
            luminance(appearance.backgroundColor),
          ].sort((a, b) => b - a);
          assert.ok(
            (values[0] + 0.05) / (values[1] + 0.05) >= 4.5,
            `${kind} / ${color}`,
          );
        }
      }
});

function publicHooks(addresses, request) {
  return loadModule("src/lib/public-webhook.ts", {
    "node:dns/promises": { lookup: async () => addresses },
    "node:https": { request },
    "./auth": auth,
    "./risk-matching": matching,
  });
}
test("merchant webhooks reject local, reserved, mapped and mixed DNS targets", async () => {
  const hooks = publicHooks([
    { address: "8.8.8.8", family: 4 },
    { address: "127.0.0.1", family: 4 },
  ]);
  for (const ip of [
    "0.0.0.0",
    "127.0.0.1",
    "10.0.1.2",
    "192.168.1.168",
    "169.254.169.254",
    "100.64.1.1",
    "198.18.0.1",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::1",
  ])
    assert.equal(hooks.isPublicWebhookIp(ip), false, ip);
  for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"])
    assert.equal(hooks.isPublicWebhookIp(ip), true, ip);
  for (const url of [
    "https://example.com/hook",
    "http://8.8.8.8",
    "https://127.0.0.1",
    "https://[::1]",
    "https://8.8.8.8:8443",
    "https://u:p@8.8.8.8",
  ])
    await assert.rejects(hooks.publicWebhookTarget(url), { status: 400 });
});
test("webhook HTTPS pins the checked address, verifies the original hostname and returns redirects without following them", async () => {
  let options,
    calls = 0;
  const hooks = publicHooks(
    [{ address: "8.8.8.8", family: 4 }],
    (input, received) => {
      options = input;
      calls++;
      const req = new EventEmitter();
      req.end = () => {
        const res = new EventEmitter();
        res.statusCode = 302;
        received(res);
        queueMicrotask(() => {
          res.emit("data", Buffer.from("redirect"));
          res.emit("end");
        });
      };
      return req;
    },
  );
  const response = await hooks.postPublicWebhook(
    "https://hook.example/path?q=1",
    "{}",
    {},
  );
  assert.equal(response.status, 302);
  assert.equal(calls, 1);
  assert.equal(options.hostname, "8.8.8.8");
  assert.equal(options.servername, "hook.example");
  assert.equal(options.headers.host, "hook.example");
  assert.equal(options.path, "/path?q=1");
  assert.equal(options.rejectUnauthorized, undefined);
  assert.equal(options.checkServerIdentity, undefined);
});
