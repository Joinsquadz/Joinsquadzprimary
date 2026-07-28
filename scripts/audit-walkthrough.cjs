#!/usr/bin/env node
/**
 * Squadz Full-App Screenshot Walkthrough
 * Runs with: node scripts/audit-walkthrough.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const https = require("https");
const http = require("http");

const APP = "https://30ec07b5-dcf1-4bcf-a30f-fefbf3736676-00-10cikl858dy0m.expo.kirk.replit.dev";
const API = "https://30ec07b5-dcf1-4bcf-a30f-fefbf3736676-00-10cikl858dy0m.kirk.replit.dev";
const OUT = "/home/runner/workspace/audit-screenshots";

// Create output dirs
for (let i = 0; i <= 9; i++) {
  fs.mkdirSync(`${OUT}/flow-${i}`, { recursive: true });
}

// ─── helpers ────────────────────────────────────────────────────────────────

function apiPost(path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const url = new URL(API + path);
    const mod = url.protocol === "https:" ? https : http;
    const req = mod.request({
      hostname: url.hostname, port: url.port || (url.protocol === "https:" ? 443 : 80),
      path: url.pathname, method: "POST",
      headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(data) }
    }, res => {
      let buf = "";
      res.on("data", c => buf += c);
      res.on("end", () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(buf) }); }
        catch { resolve({ status: res.statusCode, body: buf }); }
      });
    });
    req.on("error", reject);
    req.write(data);
    req.end();
  });
}

async function ensureAccount(email, password, firstName, lastName) {
  let r = await apiPost("/api/auth/register", { email, password, firstName, lastName });
  if (r.status === 409 || r.status === 429) {
    r = await apiPost("/api/auth/login", { email, password });
  }
  if (!r.body?.token) throw new Error(`Auth failed for ${email}: ${JSON.stringify(r)}`);
  return { token: r.body.token, userId: r.body.user?.id };
}

async function waitForApp(page) {
  // Wait for React to render actual content (not just dark splash)
  await page.waitForFunction(() => {
    const root = document.getElementById("root");
    if (!root) return false;
    const text = Array.from(root.querySelectorAll("*"))
      .map(el => (el.children.length === 0 ? el.textContent?.trim() : ""))
      .join(" ");
    return text.length > 20;
  }, { timeout: 90000 });
  // Give AuthGuard time to redirect
  await page.waitForTimeout(2000);
}

async function shot(page, path, label) {
  await page.screenshot({ path, fullPage: false });
  console.log(`  ✓ ${label} → ${path.replace(OUT + "/", "")}`);
}

async function newAuthContext(browser, token) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(60000);
  // Navigate to root first, inject token, reload
  await page.goto(APP + "/");
  await page.evaluate(tok => localStorage.setItem("@squadz/authToken", tok), token);
  await page.reload({ waitUntil: "domcontentloaded" });
  await waitForApp(page);
  return { ctx, page };
}

// ─── main ───────────────────────────────────────────────────────────────────

(async () => {
  console.log("▶ Setting up test accounts via API…");
  let tokenA, userA, tokenB, userB, tokenLimit;
  try {
    ({ token: tokenA, userId: userA } = await ensureAccount("audit-a@squadz.test", "Squadz2026!", "Audit", "Alpha"));
    console.log("  ✓ Account A:", userA);
    ({ token: tokenB, userId: userB } = await ensureAccount("audit-b@squadz.test", "Squadz2026!", "Audit", "Bravo"));
    console.log("  ✓ Account B:", userB);
    ({ token: tokenLimit } = await ensureAccount("audit-limit@squadz.test", "Squadz2026!", "Limit", "Test"));
    console.log("  ✓ Account Limit");
  } catch (e) {
    console.error("API setup failed:", e.message);
    process.exit(1);
  }

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });

  // ── FLOW 0: Auth & Landing ─────────────────────────────────────────────────
  console.log("\n▶ Flow 0: Auth & Landing");
  {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    page.setDefaultTimeout(60000);

    // Step 1: unauthenticated root — app should redirect to login landing
    await page.goto(APP + "/");
    await waitForApp(page);
    await shot(page, `${OUT}/flow-0/01-landing.png`, "landing page");

    // Step 2: look for "I already have an account" — shows login form
    const loginBtn = page.locator("text=/already have an account/i").first();
    if (await loginBtn.isVisible()) {
      await loginBtn.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-0/02-login-form.png`, "login form");

    // Step 3: fill and submit login
    const emailInput = page.locator('[placeholder*="email" i], [placeholder*="Email" i]').first();
    const passInput = page.locator('[placeholder*="password" i], [placeholder*="Password" i]').first();
    if (await emailInput.isVisible()) {
      await emailInput.fill("audit-a@squadz.test");
      await passInput.fill("Squadz2026!");
      await shot(page, `${OUT}/flow-0/03-login-filled.png`, "login filled");
      // Submit
      const submitBtn = page.locator('button:has-text("Log In"), button:has-text("Sign In"), button:has-text("Login")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
      } else {
        await passInput.press("Enter");
      }
      await page.waitForTimeout(3000);
      await shot(page, `${OUT}/flow-0/04-post-login.png`, "post login");
    }

    // Step 4: show signup form
    await page.goto(APP + "/");
    await waitForApp(page);
    const signupBtn = page.locator("text=/get started/i, text=/sign up/i, text=/create account/i").first();
    if (await signupBtn.isVisible()) {
      await signupBtn.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-0/05-signup-form.png`, "signup form");

    await ctx.close();
  }

  // ── FLOW 1: Home & Squads ─────────────────────────────────────────────────
  console.log("\n▶ Flow 1: Home & Squads (Account A)");
  let squadId, inviteCode;
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    await shot(page, `${OUT}/flow-1/01-home.png`, "home screen");

    // Navigate to Squads tab
    const squadsTab = page.locator('[aria-label*="Squad" i], text=/^squads$/i, text=/^squadz$/i').first();
    if (await squadsTab.isVisible()) {
      await squadsTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-1/02-squads-tab.png`, "squads tab");

    // Create squad
    const createBtn = page.locator('[aria-label*="create" i], button:has-text("+"), button:has-text("New"), button:has-text("Create")').first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, `${OUT}/flow-1/03-create-squad-form.png`, "create squad form");

      const nameInput = page.locator('[placeholder*="name" i], [placeholder*="squad" i]').first();
      if (await nameInput.isVisible()) {
        await nameInput.fill("Alpha Crew");
        await shot(page, `${OUT}/flow-1/04-squad-name-filled.png`, "squad name filled");
      }

      const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done"), button:has-text("Save")').first();
      if (await submitBtn.isVisible()) {
        await submitBtn.click();
        await page.waitForTimeout(2000);
      }
    }
    await shot(page, `${OUT}/flow-1/05-squad-detail.png`, "squad detail");

    // Try to get invite link/code from the URL
    const currentUrl = page.url();
    console.log("  Current URL after squad create:", currentUrl);
    const idMatch = currentUrl.match(/squad\/([a-z0-9-]+)/i);
    if (idMatch) squadId = idMatch[1];

    // Look for invite/share button
    const inviteBtn = page.locator('[aria-label*="invite" i], [aria-label*="share" i], text=/invite/i, text=/share/i').first();
    if (await inviteBtn.isVisible()) {
      await inviteBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, `${OUT}/flow-1/06-invite-screen.png`, "invite screen");
      // Try to read the invite code from the page
      const codeText = await page.evaluate(() => {
        const matches = document.body.innerText.match(/[A-Z0-9]{6,10}/);
        return matches ? matches[0] : null;
      });
      if (codeText) inviteCode = codeText;
      console.log("  Invite code found:", inviteCode);
      // Go back
      const backBtn = page.locator('[aria-label*="back" i], text=/^back$/i').first();
      if (await backBtn.isVisible()) await backBtn.click();
    }

    await ctx.close();
  }

  // ── FLOW 2: Create Trip ───────────────────────────────────────────────────
  console.log("\n▶ Flow 2: Trip Creation");
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    // Find the create button (usually a + in the middle of tab bar)
    const createTab = page.locator('[aria-label*="create" i], [aria-label="Add"], text=/^\\+$/').first();
    if (await createTab.isVisible()) {
      await createTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-2/01-create-screen.png`, "create screen");

    // Switch to Trip mode
    const tripToggle = page.locator("text=/^trip$/i, text=/^trips$/i").first();
    if (await tripToggle.isVisible()) {
      await tripToggle.click();
      await page.waitForTimeout(1000);
    }
    await shot(page, `${OUT}/flow-2/02-trip-form.png`, "trip form");

    // Fill title
    const titleInput = page.locator('[placeholder*="title" i], [placeholder*="name" i]').first();
    if (await titleInput.isVisible()) {
      await titleInput.fill("Summit Trip 2026");
    }
    // Fill location
    const locInput = page.locator('[placeholder*="location" i], [placeholder*="where" i]').first();
    if (await locInput.isVisible()) {
      await locInput.fill("Lake Tahoe");
    }
    await shot(page, `${OUT}/flow-2/03-trip-filled.png`, "trip filled");

    // Submit
    const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done"), button:has-text("Save")').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }
    await shot(page, `${OUT}/flow-2/04-trip-detail.png`, "trip detail after create");

    await ctx.close();
  }

  // ── FLOW 3: Create Event ──────────────────────────────────────────────────
  console.log("\n▶ Flow 3: Event Creation");
  let eventId;
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    const createTab = page.locator('[aria-label*="create" i], [aria-label="Add"]').first();
    if (await createTab.isVisible()) {
      await createTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-3/01-create-screen.png`, "create screen (event mode)");

    // Make sure Event mode is active (not Trip)
    const eventToggle = page.locator("text=/^event$/i, text=/^events$/i").first();
    if (await eventToggle.isVisible()) {
      await eventToggle.click();
      await page.waitForTimeout(500);
    }
    await shot(page, `${OUT}/flow-3/02-event-form.png`, "event form");

    const titleInput = page.locator('[placeholder*="title" i], [placeholder*="name" i]').first();
    if (await titleInput.isVisible()) await titleInput.fill("Friday BBQ");
    const locInput = page.locator('[placeholder*="location" i], [placeholder*="where" i]').first();
    if (await locInput.isVisible()) await locInput.fill("Central Park");
    await shot(page, `${OUT}/flow-3/03-event-filled.png`, "event filled");

    const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done"), button:has-text("Save")').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(2000);
    }
    await shot(page, `${OUT}/flow-3/04-event-detail.png`, "event detail");

    const url = page.url();
    const match = url.match(/event\/([a-z0-9-]+)/i);
    if (match) eventId = match[1];
    console.log("  Event ID:", eventId);

    // RSVP as Account B
    if (eventId) {
      const ctxB = await browser.newContext({ viewport: { width: 390, height: 844 } });
      const pageB = await ctxB.newPage();
      pageB.setDefaultTimeout(60000);
      await pageB.goto(APP + "/");
      await pageB.evaluate(tok => localStorage.setItem("@squadz/authToken", tok), tokenB);
      await pageB.reload({ waitUntil: "domcontentloaded" });
      await waitForApp(pageB);
      await pageB.goto(APP + "/event/" + eventId);
      await waitForApp(pageB);
      await shot(pageB, `${OUT}/flow-3/05-event-as-b.png`, "event as B");

      const goingBtn = pageB.locator("text=/going/i").first();
      if (await goingBtn.isVisible()) {
        await goingBtn.click();
        await pageB.waitForTimeout(1500);
        await shot(pageB, `${OUT}/flow-3/06-rsvp-going.png`, "RSVP going");
      }
      await ctxB.close();
    }

    await ctx.close();
  }

  // ── FLOW 4: Photos & Vault ────────────────────────────────────────────────
  console.log("\n▶ Flow 4: Photos & Vault");
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    // Click Photos tab
    const photosTab = page.locator('[aria-label*="photo" i], text=/^photos$/i').first();
    if (await photosTab.isVisible()) {
      await photosTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-4/01-photos-tab.png`, "photos tab");

    // Navigate to vault
    await page.goto(APP + "/vault");
    await waitForApp(page);
    await shot(page, `${OUT}/flow-4/02-vault-screen.png`, "vault screen");

    await ctx.close();
  }

  // ── FLOW 5: Messages ──────────────────────────────────────────────────────
  console.log("\n▶ Flow 5: Messages");
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    const messagesTab = page.locator('[aria-label*="message" i], text=/^messages$/i').first();
    if (await messagesTab.isVisible()) {
      await messagesTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-5/01-messages.png`, "messages tab");

    // If squad exists, click squad conversation
    const squadConv = page.locator("text=/alpha crew/i").first();
    if (await squadConv.isVisible({ timeout: 3000 }).catch(() => false)) {
      await squadConv.click();
      await page.waitForTimeout(1500);
      await shot(page, `${OUT}/flow-5/02-squad-chat.png`, "squad chat");

      const msgInput = page.locator('[placeholder*="message" i], [placeholder*="type" i]').first();
      if (await msgInput.isVisible()) {
        await msgInput.fill("Hey squad! 🔥");
        await shot(page, `${OUT}/flow-5/03-message-typed.png`, "message typed");
        const sendBtn = page.locator('[aria-label*="send" i]').first();
        if (await sendBtn.isVisible()) {
          await sendBtn.click();
          await page.waitForTimeout(1500);
          await shot(page, `${OUT}/flow-5/04-message-sent.png`, "message sent");
        }
      }
    }

    await ctx.close();
  }

  // ── FLOW 6: Vibe Feed ─────────────────────────────────────────────────────
  console.log("\n▶ Flow 6: Vibe Feed");
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    const feedTab = page.locator('[aria-label*="vibe" i], [aria-label*="feed" i], text=/^vibe$/i').first();
    if (await feedTab.isVisible()) {
      await feedTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-6/01-vibe-feed.png`, "vibe feed");

    // Compose
    const composeBtn = page.locator('[aria-label*="compose" i], [aria-label*="post" i], [aria-label*="new" i]').first();
    if (await composeBtn.isVisible()) {
      await composeBtn.click();
      await page.waitForTimeout(1500);
      await shot(page, `${OUT}/flow-6/02-vibe-compose.png`, "vibe compose");
    }

    await ctx.close();
  }

  // ── FLOW 7: Profile & Settings ────────────────────────────────────────────
  console.log("\n▶ Flow 7: Profile & Settings");
  {
    const { ctx, page } = await newAuthContext(browser, tokenA);

    // Profile is usually accessed from home screen header avatar
    // Try going to /profile directly
    await page.goto(APP + "/profile");
    await waitForApp(page);
    await shot(page, `${OUT}/flow-7/01-profile.png`, "profile screen");

    // Settings
    await page.goto(APP + "/settings/notifications");
    await waitForApp(page);
    await shot(page, `${OUT}/flow-7/02-notification-settings.png`, "notification settings");

    await page.goto(APP + "/settings/edit-profile");
    await waitForApp(page);
    await shot(page, `${OUT}/flow-7/03-edit-profile.png`, "edit profile");

    await ctx.close();
  }

  // ── FLOW 8: Squad limit (free tier) ──────────────────────────────────────
  console.log("\n▶ Flow 8: Squad limit (Limit account)");
  {
    const { ctx, page } = await newAuthContext(browser, tokenLimit);

    await shot(page, `${OUT}/flow-8/01-home-limit-user.png`, "home (limit user)");

    // Go to squads tab
    const squadsTab = page.locator('[aria-label*="Squad" i], text=/^squads$/i, text=/^squadz$/i').first();
    if (await squadsTab.isVisible()) {
      await squadsTab.click();
      await page.waitForTimeout(1000);
    }
    await shot(page, `${OUT}/flow-8/02-squads-empty.png`, "squads empty");

    // Create squad 1
    const createBtn = page.locator('[aria-label*="create" i], button:has-text("+"), button:has-text("New")').first();
    if (await createBtn.isVisible()) {
      await createBtn.click();
      await page.waitForTimeout(1000);
      const nameInput = page.locator('[placeholder*="name" i], [placeholder*="squad" i]').first();
      if (await nameInput.isVisible()) await nameInput.fill("Limit Squad 1");
      const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done")').first();
      if (await submitBtn.isVisible()) { await submitBtn.click(); await page.waitForTimeout(2000); }
    }
    await shot(page, `${OUT}/flow-8/03-squad1-created.png`, "squad 1 created");

    // Create squad 2
    const squadsTab2 = page.locator('[aria-label*="Squad" i], text=/^squads$/i, text=/^squadz$/i').first();
    if (await squadsTab2.isVisible()) { await squadsTab2.click(); await page.waitForTimeout(1000); }
    const createBtn2 = page.locator('[aria-label*="create" i], button:has-text("+"), button:has-text("New")').first();
    if (await createBtn2.isVisible()) {
      await createBtn2.click();
      await page.waitForTimeout(1000);
      const nameInput = page.locator('[placeholder*="name" i], [placeholder*="squad" i]').first();
      if (await nameInput.isVisible()) await nameInput.fill("Limit Squad 2");
      const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done")').first();
      if (await submitBtn.isVisible()) { await submitBtn.click(); await page.waitForTimeout(2000); }
    }
    await shot(page, `${OUT}/flow-8/04-squad2-created.png`, "squad 2 created");

    // Try squad 3 — should hit limit / show upgrade modal
    const squadsTab3 = page.locator('[aria-label*="Squad" i], text=/^squads$/i, text=/^squadz$/i').first();
    if (await squadsTab3.isVisible()) { await squadsTab3.click(); await page.waitForTimeout(1000); }
    const createBtn3 = page.locator('[aria-label*="create" i], button:has-text("+"), button:has-text("New")').first();
    if (await createBtn3.isVisible()) {
      await createBtn3.click();
      await page.waitForTimeout(2000);
    }
    await shot(page, `${OUT}/flow-8/05-squad-limit-paywall.png`, "squad limit paywall");

    await ctx.close();
  }

  // ── FLOW 9: Event limit (free tier) ──────────────────────────────────────
  console.log("\n▶ Flow 9: Event limit (Limit account)");
  {
    const { ctx, page } = await newAuthContext(browser, tokenLimit);

    // Create events 1–5 via API (fast)
    const eventTitles = ["Event A", "Event B", "Event C", "Event D", "Event E"];
    for (const title of eventTitles) {
      const r = await new Promise((resolve) => {
        const data = JSON.stringify({
          title, description: "Audit test event",
          eventAt: "2026-09-01T18:00:00.000Z",
          location: "Test Location", type: "event"
        });
        const url = new URL(API + "/api/events");
        const mod = url.protocol === "https:" ? https : http;
        const req = mod.request({
          hostname: url.hostname, port: url.port || 443,
          path: url.pathname, method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(data),
            "Authorization": `Bearer ${tokenLimit}`
          }
        }, res => {
          let buf = ""; res.on("data", c => buf += c);
          res.on("end", () => resolve({ status: res.statusCode }));
        });
        req.on("error", () => resolve({ status: 0 }));
        req.write(data); req.end();
      });
      console.log(`  Created ${title}: HTTP ${r.status}`);
    }

    // Now try to create the 6th via UI
    const createTab = page.locator('[aria-label*="create" i], [aria-label="Add"]').first();
    if (await createTab.isVisible()) {
      await createTab.click();
      await page.waitForTimeout(1500);
    }
    await shot(page, `${OUT}/flow-9/01-create-event-6-attempt.png`, "create event 6 attempt");

    // Fill and submit 6th event
    const eventToggle = page.locator("text=/^event$/i").first();
    if (await eventToggle.isVisible()) { await eventToggle.click(); await page.waitForTimeout(500); }
    const titleInput = page.locator('[placeholder*="title" i], [placeholder*="name" i]').first();
    if (await titleInput.isVisible()) await titleInput.fill("Event F (over limit)");
    await shot(page, `${OUT}/flow-9/02-event-form-with-counter.png`, "event form with counter");
    const submitBtn = page.locator('button:has-text("Create"), button:has-text("Done")').first();
    if (await submitBtn.isVisible()) {
      await submitBtn.click();
      await page.waitForTimeout(2500);
    }
    await shot(page, `${OUT}/flow-9/03-event-limit-paywall.png`, "event limit paywall");

    await ctx.close();
  }

  await browser.close();

  // List saved screenshots
  const files = [];
  for (let i = 0; i <= 9; i++) {
    const dir = `${OUT}/flow-${i}`;
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(f => {
        if (f.endsWith(".png")) files.push(`flow-${i}/${f}`);
      });
    }
  }
  console.log(`\n✅ Done! ${files.length} screenshots saved:`);
  files.forEach(f => console.log("  ", f));
})().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
