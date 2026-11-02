const { chromium } = require(process.env.PLAYWRIGHT_CORE || "playwright-core");
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROME || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto("http://127.0.0.1:" + (process.env.PORT || 8781) + "/index.html");
  await page.waitForFunction(() => window.k4 && window.k4.editor);
  const ready = await page.evaluate(() => window.k4.editor.ready.then((r) => r.engine));
  const out = { engine: ready, hasApplyEdits: await page.evaluate(() => window.k4.hasApplyEdits) };
  // Preview shows the course include through hooks.fetchInclude.
  await page.waitForTimeout(2500);
  const frames = page.frames().map((f) => f.url());
  let included = false;
  for (const f of page.frames()) { try { if ((await f.content()).includes("Included <strong>paragraph</strong>")) included = true; } catch {} }
  out.includeShown = included; out.frames = frames.length;
  // Typing: a change event, kept text.
  await page.evaluate(() => { const e = window.k4.editor; e.setText(e.getText().replace("First paragraph.", "First paragraph, edited.")); });
  out.changes = await page.evaluate(() => window.k4.changes.length);
  // A remote change to another block: one edit, undo history kept.
  const before = await page.evaluate(() => window.k4.editor.getText());
  const remote = before.replace("Last paragraph.", "Last paragraph, by a co-author.");
  out.applyVia = await page.evaluate((t) => window.k4.applyRemote(t), remote);
  out.afterRemote = await page.evaluate(() => window.k4.editor.getText().includes("by a co-author") && window.k4.editor.getText().includes("edited"));
  out.undoWorks = await page.evaluate(() => { const e = window.k4.editor; e.undo(); return !e.getText().includes("by a co-author"); });
  await page.evaluate(() => window.k4.editor.redo());
  // Save (Cmd+S path) → hooks.save → device + sync now.
  const save = await page.evaluate(() => window.k4.editor.save());
  out.save = save; out.sent = await page.evaluate(() => window.k4.sent.length);
  out.uid = await page.evaluate(() => window.k4.editor.ensureUid());
  out.errors = errors;
  console.log(JSON.stringify(out, null, 1));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
