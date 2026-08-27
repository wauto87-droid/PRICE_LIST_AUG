import { test } from "node:test";
import assert from "node:assert/strict";
import { installState } from "../frontend/pwa-state";
const base = {
  development: false,
  installed: false,
  ios: false,
  secure: true,
  promptAvailable: false,
};
test("PWA install-state precedence covers installed, development, HTTPS, iOS and prompts", () => {
  assert.equal(
    installState({
      ...base,
      installed: true,
      development: true,
      secure: false,
    }),
    "installed",
  );
  assert.equal(
    installState({ ...base, development: true, promptAvailable: true }),
    "development",
  );
  assert.equal(installState({ ...base, secure: false, ios: true }), "insecure");
  assert.equal(
    installState({ ...base, ios: true, promptAvailable: true }),
    "ios",
  );
  assert.equal(installState({ ...base, promptAvailable: true }), "ready");
  assert.equal(installState(base), "browser");
});
