import { expect, test } from "@playwright/test";

const INVITE_CODE = "SQUAD-739";
const INVITE_PATH = `/squad/join?code=${encodeURIComponent(INVITE_CODE)}`;

async function installCopyStubs(page, behavior) {
  await page.addInitScript(({ execCommandSucceeds, clipboardSucceeds }) => {
    const copyCalls = [];
    const clipboardCalls = [];

    Object.defineProperty(window, "__copyCalls", { value: copyCalls });
    Object.defineProperty(window, "__clipboardCalls", { value: clipboardCalls });
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value(command) {
        if (command === "copy") {
          const activeElement = document.activeElement;
          copyCalls.push(
            activeElement instanceof HTMLTextAreaElement ? activeElement.value : "",
          );
        }
        return command === "copy" && execCommandSucceeds;
      },
    });
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: {
        async writeText(value) {
          clipboardCalls.push(value);
          if (!clipboardSucceeds) throw new Error("Clipboard blocked");
        },
      },
    });
  }, behavior);
}

async function expectVisibleSelectableCode(page) {
  const code = page.getByText(INVITE_CODE, { exact: true });
  await expect(code).toBeVisible();
  await expect(code).toHaveCSS("user-select", "all");

  const selectedText = await code.evaluate((element) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection?.removeAllRanges();
    selection?.addRange(range);
    return selection?.toString();
  });
  expect(selectedText).toBe(INVITE_CODE);
}

test("copies the displayed code synchronously before trying Clipboard API", async ({
  page,
}) => {
  await installCopyStubs(page, {
    execCommandSucceeds: true,
    clipboardSucceeds: true,
  });
  await page.goto(INVITE_PATH);

  await expectVisibleSelectableCode(page);
  await page.getByRole("button", { name: "Copy invite code" }).click();

  await expect(page.getByRole("status")).toHaveText("Invite code copied.");
  await expect(page.getByRole("button", { name: "Copy invite code" })).toHaveText(
    "Copied!",
  );
  expect(await page.evaluate(() => window.__copyCalls)).toEqual([INVITE_CODE]);
  expect(await page.evaluate(() => window.__clipboardCalls)).toEqual([]);
});

test("uses Clipboard API after the synchronous fallback fails", async ({ page }) => {
  await installCopyStubs(page, {
    execCommandSucceeds: false,
    clipboardSucceeds: true,
  });
  await page.goto(INVITE_PATH);

  await expectVisibleSelectableCode(page);
  await page.getByRole("button", { name: "Copy invite code" }).click();

  await expect(page.getByRole("status")).toHaveText("Invite code copied.");
  expect(await page.evaluate(() => window.__copyCalls)).toEqual([INVITE_CODE]);
  expect(await page.evaluate(() => window.__clipboardCalls)).toEqual([INVITE_CODE]);
});

test("shows a manual selectable fallback when both copy methods fail", async ({
  page,
}) => {
  await installCopyStubs(page, {
    execCommandSucceeds: false,
    clipboardSucceeds: false,
  });
  await page.goto(INVITE_PATH);

  await page.getByRole("button", { name: "Copy invite code" }).click();

  await expect(page.getByRole("status")).toHaveText(
    "Copy failed. Select the code and copy it manually.",
  );
  await expectVisibleSelectableCode(page);
  expect(await page.evaluate(() => window.__copyCalls)).toEqual([INVITE_CODE]);
  expect(await page.evaluate(() => window.__clipboardCalls)).toEqual([INVITE_CODE]);
});