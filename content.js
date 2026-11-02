(() => {
  // Guard against double injection. After the extension is reloaded, the old copy of
  // this script stays on the page but is disconnected; let the new copy take over.
  const alive = () => {
    try {
      return !!chrome.runtime?.id;
    } catch {
      return false;
    }
  };
  if (window.__ljfAlive && window.__ljfAlive()) return;
  window.__ljfAlive = alive;
  document.getElementById("ljf-panel")?.remove(); // panel left by a disconnected old copy

  let running = false;
  let stopRequested = false;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === "LJF_TOGGLE") {
      if (running && !ui.visible()) {
        ui.show(); // panel was closed: just bring it back, keep running
        ui.status("Running…");
      } else if (running) {
        stopRequested = true;
        ui.status("Stopping after the current job…");
      } else if (!getCards().length) {
        // This frame has no job list. LinkedIn may render the list in an iframe that
        // runs its own copy of this script, so only the top frame reports, and only
        // if no frame on the page has cards.
        if (window === window.top) setTimeout(() => {
          if (!document.documentElement.dataset.ljfFrameStarted) diagnose();
        }, 1500);
      } else {
        try { window.top.document.documentElement.dataset.ljfFrameStarted = "1"; } catch {}
        run().catch((e) => {
          ui.status("Error: " + e.message);
          finish();
        });
      }
      sendResponse({ ok: true });
    }
  });

  // ================= DOM helpers (LinkedIn changes these often, so each has fallbacks) =================

  // LinkedIn 2026 "SDUI" layout (hashed class names):
  //   card:        div[role=button][componentkey="job-card-component-ref-<jobId>"]
  //   description: [componentkey="JobDetails_AboutTheJob_<jobId>"] inside [data-sdui-screen*="JobDetails"]
  //   title/company: document.title = "Title | Company | LinkedIn"
  // Older classic layout selectors are kept as fallback.
  const LJF_DEFAULT_COMMUTE = ""; // no default places: set them on the options page

  const NEW_CARD = '[componentkey^="job-card-component-ref-"]';

  function getCards() {
    // the same componentkey can appear on nested elements; keep the outermost
    let cards = [...document.querySelectorAll(NEW_CARD)].filter(
      (c) => !c.parentElement?.closest(`[componentkey="${c.getAttribute("componentkey")}"]`)
    );
    if (!cards.length) cards = [...document.querySelectorAll("li[data-occludable-job-id]")];
    if (!cards.length) cards = [...document.querySelectorAll("[data-job-id]")].map((e) => e.closest("li") || e);
    return [...new Set(cards)];
  }

  function cardJobId(card) {
    const key = card.getAttribute("componentkey") || "";
    const m0 = key.match(/^job-card-component-ref-(\d+)/);
    if (m0) return m0[1];
    const id =
      card.getAttribute("data-occludable-job-id") ||
      card.getAttribute("data-job-id") ||
      card.querySelector("[data-job-id]")?.getAttribute("data-job-id");
    if (id && /^\d+$/.test(id)) return id;
    const a = card.querySelector('a[href*="/jobs/view/"], a[href*="currentJobId="]');
    const m = a?.href.match(/\/jobs\/view\/(\d+)|currentJobId=(\d+)/);
    return m ? m[1] || m[2] : null;
  }

  function findCard(jobId) {
    return (
      document.querySelector(`[componentkey="job-card-component-ref-${jobId}"]`) || // first match = outermost

      document.querySelector(`li[data-occludable-job-id="${jobId}"]`) ||
      document.querySelector(`[data-job-id="${jobId}"]`)?.closest("li") ||
      document.querySelector(`[data-job-id="${jobId}"]`) ||
      null
    );
  }

  // The card's wrapper: the highest ancestor (up to 5 levels) that still contains only
  // this one job card. The dismiss button and the "We won't show you this job again"
  // message may sit next to the card element rather than inside it.
  function cardScope(card) {
    let scope = card;
    let el = card.parentElement;
    for (let i = 0; i < 5 && el; i++, el = el.parentElement) {
      const ids = new Set(getCardsIn(el).map(cardJobId));
      if (ids.size > 1) break;
      scope = el;
    }
    return scope;
  }
  function getCardsIn(root) {
    const sel = '[componentkey^="job-card-component-ref-"], li[data-occludable-job-id], [data-job-id]';
    return [...root.querySelectorAll(sel)];
  }

  // LinkedIn wording varies by page: "We won't show you this job again" (search) or
  // "We won't recommend this job anymore" (preferences feed); the undo button says "… job is dismissed, undo".
  const DISMISSED_TEXT =
    /won[’']?t show you this job|we won[’']?t show|won[’']?t recommend this job|job is dismissed|job dismissed|visar inte (det här|detta) jobb|rekommenderar inte/i;

  // Dismissed *on this page* (what LinkedIn actually shows). The stored dismissedIds list is not
  // enough: a job dismissed elsewhere, or undone, can show up again un-dismissed (e.g. in the preferences feed).
  function isDismissed(card) {
    return (
      !!card.querySelector(".job-card-list--is-dismissed") ||
      DISMISSED_TEXT.test(card.innerText || "") ||
      DISMISSED_TEXT.test(cardScope(card).innerText || "")
    );
  }

  // Remember dismissed jobs (by us or by hand), so they are never checked again
  let dismissedIds = new Set();
  chrome.storage.local.get("dismissedIds").then(({ dismissedIds: d }) => {
    for (const id of d || []) dismissedIds.add(id);
  });
  function rememberDismissed(jobId) {
    if (!jobId || dismissedIds.has(jobId)) return;
    dismissedIds.add(jobId);
    const arr = [...dismissedIds].slice(-5000);
    chrome.storage.local.set({ dismissedIds: arr }).catch(() => {});
  }
  // Catch the user's own clicks on ✕ too
  document.addEventListener(
    "click",
    (e) => {
      const btn = e.target.closest?.('button[aria-label^="Dismiss" i], button[aria-label*="Avfärda" i]');
      if (!btn) return;
      let el = btn;
      for (let i = 0; i < 8 && el; i++, el = el.parentElement) {
        const ids = [...new Set(getCardsIn(el).map(cardJobId))].filter(Boolean);
        if (el.matches?.('[componentkey^="job-card-component-ref-"]')) ids.push(cardJobId(el));
        const uniq = [...new Set(ids)];
        if (uniq.length === 1) return rememberDismissed(uniq[0]);
        if (uniq.length > 1) return;
      }
    },
    true
  );

  // "Applied" is shown as its own text element on the card: alone ("Applied"), or as
  // "Applied · 2 days ago" / "Applied on company site". Checking individual text nodes (instead of
  // the glued card text) also avoids false hits on titles such as "Applied AI Engineer".
  const APPLIED_TEXT = /^(applied|ansökt|sökt)(\s*(·|•|on\b|\d).*)?$/i;
  function isApplied(card) {
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest(".ljf-badge")) continue;
      if (APPLIED_TEXT.test(n.textContent.replace(/\s+/g, " ").trim())) return true;
    }
    return false;
  }

  function findDismissButton(card) {
    const btns = [...cardScope(card).querySelectorAll("button")];
    return (
      btns.find((b) => /^dismiss|avfärda|hide this job|dölj/i.test(b.getAttribute("aria-label") || "")) ||
      card.querySelector("button.job-card-container__action") ||
      null
    );
  }

  function currentJobIdFromUrl() {
    let id = new URL(location.href).searchParams.get("currentJobId");
    if (!id) {
      try {
        id = new URL(window.top.location.href).searchParams.get("currentJobId");
      } catch {}
    }
    return id;
  }

  async function expandDescription(el) {
    const btn = [...el.querySelectorAll("button")].find((b) => {
      const t = (b.innerText || "").trim().toLowerCase();
      const a = (b.getAttribute("aria-label") || "").toLowerCase();
      return /^(…\s*)?(see |show )?more$|^(…\s*)?visa mer$/.test(t) || a.includes("see more description");
    });
    if (btn) {
      btn.click();
      await sleep(400);
    }
  }

  const NOISE = [
    /reactivate premium.*/gi,
    /unlock hiring insights.*/gi,
    /see how you compare to \d+ others.*/gi,
    /access exclusive applicant insights.*/gi,
    /get ai-powered advice.*/gi,
    /upgrade to premium/gi,
    /try premium.*/gi
  ];
  function cleanText(t) {
    let out = t;
    for (const r of NOISE) out = out.replace(r, "");
    return out.replace(/\n{3,}/g, "\n\n").trim();
  }

  // Wait until the element's text is non-trivial and stopped changing
  async function waitStable(getEl, minLen, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    while (Date.now() < deadline) {
      await sleep(250);
      const el = getEl();
      const len = el ? el.innerText.length : 0;
      if (len >= minLen && len === last) return el;
      last = len;
    }
    return getEl();
  }

  // Click the card, wait for its details, return the job data to score
  async function openAndExtract(card, jobId) {
    card.scrollIntoView({ block: "center" });
    await sleep(300);
    const isNewLayout = card.hasAttribute("componentkey");
    const clickTarget = isNewLayout
      ? card
      : card.querySelector('a[href*="/jobs/view/"], a.job-card-container__link, a.job-card-list__title--link') || card;
    clickTarget.click();
    const cardText = (card.innerText || "").replace(/\s*\n\s*/g, " | ").slice(0, 500);

    if (isNewLayout) {
      const aboutSel = `[componentkey="JobDetails_AboutTheJob_${jobId}"]`;
      let about = await waitStable(() => document.querySelector(aboutSel), 80, 12000);
      if (!about || about.innerText.length < 80) throw new Error("Job details did not load");
      await expandDescription(about);
      about = document.querySelector(aboutSel) || about;
      const screen = about.closest('[data-sdui-screen*="JobDetails"]') || about.parentElement;
      // header (title, company, location, hybrid/remote...) is at the top of the details screen
      const header = cleanText(screen.innerText.slice(0, 900));
      const [title = "", company = ""] = document.title.split(" | ");
      return {
        title: title.trim(),
        company: company.trim(),
        cardText,
        detailText: (header + "\n\n" + cleanText(about.innerText)).slice(0, 7000)
      };
    }

    // classic layout
    const paneSel =
      ".jobs-search__job-details--container, .jobs-search__job-details, .scaffold-layout__detail, .jobs-details";
    const pane = await waitStable(
      () => (currentJobIdFromUrl() === jobId ? document.querySelector(paneSel) : null),
      300,
      12000
    );
    if (!pane || pane.innerText.length < 300) throw new Error("Job details did not load");
    await expandDescription(pane);
    return {
      title: (pane.querySelector("h1, .job-details-jobs-unified-top-card__job-title")?.innerText || "").trim(),
      company: (pane.querySelector(".job-details-jobs-unified-top-card__company-name")?.innerText || "").trim(),
      cardText,
      detailText: cleanText(pane.innerText).slice(0, 7000)
    };
  }

  // ================= Keyword auto-dismiss =================
  // Card metadata lines that are not title / company / location
  const CARD_META =
    /promoted|easy apply|viewed|applied|\bago\b|applicant|connection|alumni|actively|reviewing|be an early|verified|saved|work here|top applicant|clicked apply|response|insight/i;

  // Title, company and location texts of a card (leaf text nodes minus metadata)
  function cardFields(card) {
    const out = [];
    const walker = document.createTreeWalker(card, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (n.parentElement?.closest(".ljf-badge, button")) continue;
      const t = n.textContent.replace(/\s+/g, " ").trim();
      if (t && t.length > 1 && !CARD_META.test(t)) out.push(t);
    }
    return [...new Set(out)];
  }

  function parseKeywords(str) {
    return String(str || "")
      .split(",")
      .map((k) => k.trim())
      .filter(Boolean)
      .map((k) => ({
        k,
        // whole-word match, case-insensitive ("intern" won't match "international")
        re: new RegExp(`(^|[^\\p{L}\\p{N}])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=[^\\p{L}\\p{N}]|$)`, "iu")
      }));
  }

  // Auto-dismiss keywords: NOT trimmed, spaces are significant (" AI " ≠ "AI").
  // Case-insensitive substring match. Each field is padded with one space on both sides,
  // so " Intern " also matches at the very start/end of a title.
  function parseBlockKeywords(str) {
    return String(str || "")
      .split(/[,\n]/)
      .filter((k) => k.trim() !== "")
      .map((k) => ({ k, low: k.toLowerCase() }));
  }

  function keywordHit(card, keywords) {
    if (!keywords.length) return null;
    for (const field of cardFields(card)) {
      const hay = (" " + field + " ").toLowerCase();
      for (const { k, low } of keywords) if (hay.includes(low)) return { keyword: k, field };
    }
    return null;
  }


  // ================= Location rule =================
  // A job must be in a commutable place (settings.commuteLocations) or be Remote.
  // Returns null if OK / unknown, or a reason string if the job should be dismissed.
  const COUNTRY_ONLY = /^(sweden|sverige|europe|european union|emea|nordics?|scandinavia|worldwide)$/i;
  function locationProblem(card, places) {
    if (!places.length) return null; // rule disabled
    const fields = cardFields(card);
    if (fields.length < 3) return null; // can't tell which text is the location
    const loc = fields[fields.length - 1]; // location is the last field on the card
    if (/\bremote\b|distans/i.test(loc)) return null;
    const place = loc.replace(/\(.*?\)/g, "").trim(); // "Lund (On-site)" -> "Lund"
    if (!place) return null;
    const parts = place.split(",").map((x) => x.trim());
    if (parts.every((x) => COUNTRY_ONLY.test(x))) return null; // too vague: let the AI decide
    if (places.some(({ re }) => re.test(place))) return null;
    return loc;
  }

  // ================= Save matching jobs =================
  // LinkedIn's Save button lives in the job details pane (not on the card):
  //   button[aria-label="Save the job"]  (text "Save")  <->  "Unsave the job" (text "Saved").
  // It is a toggle, so we only click when the label says "Save the job".
  let savedIds = new Set();
  chrome.storage.local.get("savedIds").then(({ savedIds: d }) => {
    for (const id of d || []) savedIds.add(id);
  });
  function rememberSaved(jobId) {
    savedIds.add(jobId);
    chrome.storage.local.set({ savedIds: [...savedIds].slice(-5000) }).catch(() => {});
  }

  function findSaveButton(jobId) {
    const about = document.querySelector(`[componentkey="JobDetails_AboutTheJob_${jobId}"]`);
    const screen = about?.closest('[data-sdui-screen*="JobDetails"]');
    if (!screen) return null;
    return [...screen.querySelectorAll("button")].find((b) => /^(un)?save the job$/i.test(b.getAttribute("aria-label") || "")) || null;
  }

  // Opens the job (if it isn't open already) and presses Save. Returns "saved" | "already" | "missing".
  async function saveJob(jobId) {
    if (savedIds.has(jobId)) return "already";
    let btn = findSaveButton(jobId);
    if (!btn) {
      const card = findCard(jobId);
      if (!card) return "missing";
      card.scrollIntoView({ block: "center" });
      await sleep(300);
      card.click();
      const deadline = Date.now() + 10000;
      while (!(btn = findSaveButton(jobId)) && Date.now() < deadline) await sleep(250);
      if (!btn) return "missing"; // e.g. already applied: LinkedIn shows no Save button then
    }
    if (/^unsave/i.test(btn.getAttribute("aria-label") || "")) {
      rememberSaved(jobId);
      return "already";
    }
    btn.click();
    await sleep(800);
    rememberSaved(jobId);
    return "saved";
  }

  // ================= Next page (auto) =================
  // Pagination is at the bottom of the lazy list: "1 2 3 … Next". It only renders after scrolling down.
  // Clicking Next is an in-page (SPA) navigation: the cards change and the URL gets &start=25, 50, …
  function findNextButton() {
    return (
      [...document.querySelectorAll("button, a")].find((b) => {
        const t = (b.innerText || "").trim();
        const a = b.getAttribute("aria-label") || "";
        if (!/^(next|nästa)$/i.test(t) && !/^(view )?next page$/i.test(a)) return false;
        // must sit next to the page-number buttons, so it isn't some other "Next"
        return [...(b.parentElement?.querySelectorAll("button, a") || [])].some((x) => /^\d+$/.test((x.innerText || "").trim()));
      }) || null
    );
  }

  async function goToNextPage() {
    const firstBefore = getCards().map(cardJobId)[0];
    let next = null;
    for (let i = 0; i < 8 && !(next = findNextButton()); i++) {
      const cards = getCards();
      cards[cards.length - 1]?.scrollIntoView({ block: "end" });
      await sleep(600);
    }
    if (!next || next.disabled || next.getAttribute("aria-disabled") === "true") return false;
    // if LinkedIn ever does a full page load instead, the new copy of this script continues (see bottom)
    try { sessionStorage.setItem("ljf-autorun", "1"); } catch {}
    next.click();
    const deadline = Date.now() + 15000;
    while (Date.now() < deadline) {
      await sleep(400);
      const first = getCards().map(cardJobId)[0];
      if (first && first !== firstBefore) {
        await sleep(1500); // let the new page settle
        try { sessionStorage.removeItem("ljf-autorun"); } catch {}
        return true;
      }
    }
    try { sessionStorage.removeItem("ljf-autorun"); } catch {}
    return false;
  }

  // ================= Cache (avoid paying twice for the same job) =================
  async function getCache() {
    const { scoreCache } = await chrome.storage.local.get("scoreCache");
    return scoreCache || {};
  }
  async function putCache(jobId, result) {
    const c = await getCache();
    c[jobId] = { ...result, ts: Date.now() };
    await chrome.storage.local.set({ scoreCache: c });
  }

  // ================= Main loop =================
  // pageNo > 1 = continued automatically from the previous results page (keep the log)
  async function run(pageNo = 1) {
    const { settings } = await chrome.storage.local.get("settings");
    const threshold = settings?.threshold ?? 60;
    const delayMs = (settings?.delaySec ?? 0) * 1000;
    const dryRun = !!settings?.dryRun;
    const MAX_PARALLEL = 5; // AI requests in flight at once

    running = true;
    stopRequested = false;
    ui.show();
    ui.setRunning(true);
    if (pageNo === 1) ui.reset();
    else ui.log(`—— Page ${pageNo} ——`, "", "ok");
    ui.status((pageNo > 1 ? `Page ${pageNo} · ` : "") + (dryRun ? "Running (dry run: nothing will be dismissed)…" : "Running…"));

    const processed = new Set();
    const stats = { match: 0, saved: 0, dismissed: 0, keyword: 0, location: 0, skipped: 0, errors: 0 };
    const doSave = settings?.saveMatches ?? true;
    const toSave = new Map(); // jobId -> title, saved after all scores are in (needs the details pane)
    const keywords = parseBlockKeywords(settings?.blockKeywords);
    const places = parseKeywords(settings?.commuteLocations ?? LJF_DEFAULT_COMMUTE);
    const cache = await getCache();
    const inFlight = new Set();
    let opened = 0;
    let total = 0;

    const refreshStatus = (extra = "") =>
      ui.status(`Opened ${opened}/${total} · scoring ${inFlight.size}${extra ? " · " + extra : ""}`);

    // Apply a score to a card: badge it, and press ✕ if it doesn't fit
    async function applyResult(jobId, title, result) {
      const fit = result.decision === "match" && result.score >= threshold;
      const card = findCard(jobId);
      if (card) badge(card, result, fit, jobId);
      if (fit) {
        stats.match++;
        if (doSave && !savedIds.has(jobId)) toSave.set(jobId, title);
        ui.log(`✅ ${result.score} · ${title}`, result.reason, "ok");
      } else {
        if (!dryRun) {
          const btn = card && findDismissButton(card);
          if (btn) {
            btn.click();
            rememberDismissed(jobId);
            stats.dismissed++;
          } else {
            stats.errors++;
            ui.log(`⚠️ no dismiss button · ${title}`, "", "warn");
          }
        } else stats.dismissed++;
        ui.log(`❌ ${result.score} · ${title}`, result.reason, "bad");
      }
      ui.stats(stats, dryRun);
    }

    function handleError(jobId, e) {
      stats.errors++;
      const c = findCard(jobId);
      if (c) badge(c, { label: "⚠ Error (not checked)", kind: "warn", reason: e.message }, false, jobId);
      ui.log(`⚠️ error · job ${jobId}`, e.message, "warn");
      if (/HTTP 40[13]/.test(e.message)) {
        ui.status("API key rejected. Check the extension options.");
        stopRequested = true;
      }
      ui.stats(stats, dryRun);
    }

    // Opening jobs is sequential (it's one UI), but scoring runs in the background
    // in parallel, so we don't wait for the AI before opening the next job.
    for (let pass = 0; pass < 3 && !stopRequested; pass++) {
      const ids = [...new Set(getCards().map(cardJobId))].filter((id) => id && !processed.has(id));
      if (!ids.length) break;
      total += ids.length;

      for (const jobId of ids) {
        if (stopRequested) break;
        processed.add(jobId);
        opened++;
        chrome.runtime.sendMessage({ type: "LJF_STATE", running: true, progress: String(opened) });

        const card = findCard(jobId);
        if (!card) continue;
        if (isDismissed(card) || isApplied(card)) {
          const applied = isApplied(card);
          badge(card, { label: applied ? "• Applied (skipped)" : "• Already dismissed", kind: "skip",
            reason: applied ? "You already applied to this job" : "Already dismissed on this page" }, false, jobId);
          stats.skipped++;
          ui.stats(stats, dryRun);
          continue;
        }

        // Rejected before (stored) but not dismissed on this page -> press ✕ again, no AI call
        if (dismissedIds.has(jobId) || (cache[jobId] && !(cache[jobId].decision === "match" && cache[jobId].score >= threshold))) {
          const title = cardFields(card)[0] || jobId;
          const why = cache[jobId]?.reason || "previously rejected";
          badge(card, { label: "✕ Rejected before" + (cache[jobId] ? ` · AI ${cache[jobId].score}` : ""), reason: why }, false, jobId);
          if (!dryRun) {
            const btn = findDismissButton(card);
            if (btn) {
              btn.click();
              rememberDismissed(jobId);
              await sleep(400);
            } else stats.errors++;
          }
          stats.dismissed++;
          ui.log(`✕ again (rejected before) · ${title}`, why, "bad");
          ui.stats(stats, dryRun);
          continue;
        }

        // Keyword list: dismiss right away, no AI call
        const hit = keywordHit(card, keywords);
        if (hit) {
          const title = cardFields(card)[0] || jobId;
          badge(card, { label: `🚫 Keyword: ${hit.keyword.trim()}`, reason: `Keyword "${hit.keyword}" found in "${hit.field}"` }, false, jobId);
          if (!dryRun) {
            const btn = findDismissButton(card);
            if (btn) {
              btn.click();
              rememberDismissed(jobId);
            } else stats.errors++;
          }
          stats.keyword++;
          ui.log(`🚫 keyword "${hit.keyword}" · ${title}`, hit.field, "bad");
          ui.stats(stats, dryRun);
          continue;
        }

        // Location rule: not in your commutable places and not remote -> dismiss, no AI call
        const badLoc = locationProblem(card, places);
        if (badLoc) {
          const title = cardFields(card)[0] || jobId;
          badge(card, { label: `📍 Location: ${badLoc}`, reason: `Not in your commutable places and not remote: ${badLoc}` }, false, jobId);
          if (!dryRun) {
            const btn = findDismissButton(card);
            if (btn) {
              btn.click();
              rememberDismissed(jobId);
            } else stats.errors++;
          }
          stats.location++;
          ui.log(`📍 not commutable/remote · ${title}`, badLoc, "bad");
          ui.stats(stats, dryRun);
          continue;
        }

        if (cache[jobId]) {
          await applyResult(jobId, (card.innerText || "").split("\n")[0], cache[jobId]);
          continue;
        }

        while (inFlight.size >= MAX_PARALLEL && !stopRequested) await Promise.race(inFlight);
        if (stopRequested) break;

        let job;
        try {
          refreshStatus("opening job…");
          job = await openAndExtract(card, jobId);
        } catch (e) {
          handleError(jobId, e);
          continue;
        }

        const p = chrome.runtime
          .sendMessage({ type: "LJF_SCORE", job })
          .then(async (resp) => {
            if (!resp?.ok) throw new Error(resp?.error || "No response from background");
            await putCache(jobId, resp.result);
            await applyResult(jobId, job.title, resp.result);
          })
          .catch((e) => handleError(jobId, e))
          .finally(() => {
            inFlight.delete(p);
            refreshStatus();
          });
        inFlight.add(p);
        refreshStatus();
        if (delayMs) await sleep(delayMs);
      }
    }

    refreshStatus("waiting for last scores…");
    await Promise.all(inFlight);

    // Save the matching jobs. Done at the end because scoring is asynchronous and the
    // Save button only exists in the details pane of the job that is currently open.
    let n = 0;
    for (const [jobId, title] of toSave) {
      if (stopRequested) break;
      ui.status(`Saving matches… ${++n}/${toSave.size}`);
      try {
        const r = await saveJob(jobId);
        if (r === "saved") stats.saved++;
        ui.log(r === "saved" ? `🔖 saved · ${title}` : r === "already" ? `🔖 already saved · ${title}` : `⚠️ no Save button · ${title}`, "", r === "missing" ? "warn" : "ok");
      } catch (e) {
        handleError(jobId, e);
      }
      ui.stats(stats, dryRun);
    }
    ui.status(stopRequested ? "Stopped." : `Done for this page (${opened} jobs).`);
    ui.stats(stats, dryRun);

    // Auto next page (panel checkbox): go to the next results page and continue until Stop is pressed
    if (!stopRequested && ui.autoNext()) {
      ui.status(`Page ${pageNo} done · going to the next page…`);
      const moved = await goToNextPage();
      if (moved && !stopRequested && ui.autoNext()) {
        finish();
        return run(pageNo + 1);
      }
      ui.status(stopRequested ? "Stopped." : moved ? "Stopped." : `Done · no next page after page ${pageNo}.`);
    }
    finish();
  }

  function diagnose() {
    const info = {
      url: location.href,
      iframes: [...document.querySelectorAll("iframe")].map((f) => f.src || "(no src)").slice(0, 10),
      occludable: document.querySelectorAll("li[data-occludable-job-id]").length,
      dataJobId: document.querySelectorAll("[data-job-id]").length,
      jobLinks: document.querySelectorAll('a[href*="/jobs/view/"], a[href*="currentJobId="]').length,
      dismissBtns: document.querySelectorAll('button[aria-label*="Dismiss" i]').length,
      sampleButtons: [...document.querySelectorAll("button[aria-label]")].map((b) => b.getAttribute("aria-label")).slice(0, 25)
    };
    console.log("[LJF] diagnostic", info);
    ui.show();
    ui.reset();
    ui.status("No job cards found. Diagnostic (please send this to Claude):");
    ui.log("Diagnostic", JSON.stringify(info), "warn");
  }

  function finish() {
    try { delete window.top.document.documentElement.dataset.ljfFrameStarted; } catch {}
    running = false;
    stopRequested = false;
    ui.setRunning(false);
    chrome.runtime.sendMessage({ type: "LJF_STATE", running: false });
  }

  // Badges: LinkedIn keeps a hidden and a visible copy of each card and re-renders
  // cards while scrolling, so we remember scores and re-apply badges continuously.
  const badges = new Map(); // jobId -> {score, reason, fit}

  // result: { score, reason, label?, kind? }  kind: "ok" | "bad" | "skip" | "warn"
  // Without a label, an AI result is shown as "✓ AI 82 · Strong" / "✕ AI 20 · Gap".
  function badge(_card, result, fit, jobId) {
    if (!jobId) return;
    let label = result.label;
    if (!label) {
      const tag = (String(result.reason || "").match(/^\s*\[(\w+)\]/) || [])[1];
      label = `${fit ? "✓" : "✕"} AI ${result.score}${tag ? " · " + tag : ""}`;
    }
    badges.set(jobId, { label, kind: result.kind || (fit ? "ok" : "bad"), reason: result.reason || "" });
    applyBadge(jobId);
  }
  const BADGE_COLORS = { ok: "#1e8e3e", bad: "#c5221f", skip: "#6b7280", warn: "#b06000" };

  function applyBadge(jobId) {
    const info = badges.get(jobId);
    if (!info) return;
    let targets = [...document.querySelectorAll(`[componentkey="job-card-component-ref-${jobId}"]`)];
    // innermost copy is the one that is actually displayed
    targets = targets.filter((t) => !targets.some((o) => o !== t && t.contains(o)));
    if (!targets.length) {
      const old = findCard(jobId);
      if (old) targets = [old];
    }
    for (const t of targets) {
      const existing = t.querySelector(":scope > .ljf-badge");
      if (existing && existing.textContent === info.label && existing.title === info.reason) continue;
      existing?.remove();
      const b = document.createElement("div");
      b.className = "ljf-badge";
      b.textContent = info.label;
      b.title = info.reason; // full reason on hover
      if (getComputedStyle(t).position === "static") t.style.position = "relative";
      // reserve a strip at the bottom of the card so the badge never covers LinkedIn's text
      if (t.style.paddingBottom !== "26px") t.style.paddingBottom = "26px";
      Object.assign(b.style, {
        position: "absolute",
        left: "8px",
        bottom: "4px",
        maxWidth: "calc(100% - 16px)",
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap",
        zIndex: 5,
        padding: "2px 8px",
        borderRadius: "10px",
        font: "600 12px system-ui, sans-serif",
        color: "#fff",
        background: BADGE_COLORS[info.kind] || BADGE_COLORS.bad,
        pointerEvents: "auto",
        cursor: "help"
      });
      t.appendChild(b);
    }
  }

  setInterval(() => {
    for (const id of badges.keys()) applyBadge(id);
  }, 1000);

  // If "Next" ever caused a full page load, pick up where we left off
  try {
    if (window === window.top && sessionStorage.getItem("ljf-autorun") === "1") {
      sessionStorage.removeItem("ljf-autorun");
      setTimeout(() => {
        if (!running && getCards().length && ui.autoNext()) run(2).catch((e) => { ui.status("Error: " + e.message); finish(); });
      }, 3000);
    }
  } catch {}

  // ================= Floating panel =================
  const ui = (() => {
    let root, statusEl, statsEl, logEl, autoNextEl;
    function build() {
      root = document.createElement("div");
      root.id = "ljf-panel";
      root.innerHTML = `
        <div data-r="handle" title="Drag to move" style="display:flex;align-items:center;gap:8px;margin:-10px -12px 6px;padding:8px 12px;cursor:move;user-select:none;background:#f3f6f8;border-radius:10px 10px 0 0;border-bottom:1px solid #e0e0e0">
          <strong style="flex:1">⠿ AI Job Filter</strong>
          <button data-a="details" style="cursor:pointer" title="Show/hide per-job report">Details ▾</button>
          <button data-a="rerun" style="cursor:pointer;display:none" title="Run again on the jobs now on this page">↻ Run again</button>
          <button data-a="stop" style="cursor:pointer">Stop</button>
          <button data-a="close" style="cursor:pointer">✕</button>
        </div>
        <label style="display:flex;align-items:center;gap:6px;margin-bottom:4px;cursor:pointer;user-select:none"><input type="checkbox" data-a="autonext"> Auto next page <span style="color:#777">(until Stop)</span></label>
        <div data-r="status" style="margin-bottom:4px"></div>
        <div data-r="stats" style="margin-bottom:6px;color:#555"></div>
        <div data-r="log" style="display:none;max-height:420px;overflow:auto;border-top:1px solid #ddd;padding-top:4px"></div>`;
      Object.assign(root.style, {
        position: "fixed",
        left: "16px",
        bottom: "16px",
        width: "340px",
        zIndex: 2147483647,
        background: "#fff",
        color: "#222",
        border: "1px solid #ccc",
        borderRadius: "10px",
        boxShadow: "0 6px 24px rgba(0,0,0,.18)",
        padding: "10px 12px",
        font: "13px/1.4 system-ui, sans-serif"
      });
      statusEl = root.querySelector('[data-r="status"]');
      autoNextEl = root.querySelector('[data-a="autonext"]');
      try { autoNextEl.checked = localStorage.getItem("ljf-autonext") === "1"; } catch {}
      autoNextEl.onchange = () => {
        try { localStorage.setItem("ljf-autonext", autoNextEl.checked ? "1" : "0"); } catch {}
      };
      statsEl = root.querySelector('[data-r="stats"]');
      logEl = root.querySelector('[data-r="log"]');
      // Collapsed = summary only; expanded = wider panel with the per-job report
      const detailsBtn = root.querySelector('[data-a="details"]');
      const setExpanded = (on) => {
        logEl.style.display = on ? "block" : "none";
        root.style.width = on ? "480px" : "340px";
        detailsBtn.textContent = on ? "Details ▴" : "Details ▾";
        try { localStorage.setItem("ljf-panel-expanded", on ? "1" : "0"); } catch {}
        // keep the panel on screen after it grows
        const r = root.getBoundingClientRect();
        if (r.right > window.innerWidth) root.style.left = Math.max(0, window.innerWidth - r.width - 8) + "px";
        if (r.bottom > window.innerHeight && root.style.top) root.style.top = Math.max(0, window.innerHeight - r.height - 8) + "px";
      };
      let expanded = false;
      try { expanded = localStorage.getItem("ljf-panel-expanded") === "1"; } catch {}
      detailsBtn.onclick = () => setExpanded((expanded = !expanded));
      root.querySelector('[data-a="rerun"]').onclick = () => {
        if (running) return;
        if (!getCards().length) return status("No job cards found on this page.");
        run().catch((e) => {
          status("Error: " + e.message);
          finish();
        });
      };
      root.querySelector('[data-a="stop"]').onclick = () => {
        if (running) {
          stopRequested = true;
          status("Stopping after the current job…");
        }
      };
      root.querySelector('[data-a="close"]').onclick = () => {
        root.remove();
        root = null;
      };
      document.body.appendChild(root);
      if (typeof history !== "undefined") for (const h of history) render(...h);
      makeDraggable(root, root.querySelector('[data-r="handle"]'));
      setExpanded(expanded);
    }

    // Drag the panel by its header; remember the position across page loads
    function makeDraggable(panel, handle) {
      const KEY = "ljf-panel-pos";
      const place = (x, y) => {
        x = Math.max(0, Math.min(x, window.innerWidth - panel.offsetWidth));
        y = Math.max(0, Math.min(y, window.innerHeight - 40));
        Object.assign(panel.style, { left: x + "px", top: y + "px", bottom: "auto", right: "auto" });
      };
      try {
        const pos = JSON.parse(localStorage.getItem(KEY) || "null");
        if (pos) place(pos.x, pos.y);
      } catch {}
      handle.addEventListener("pointerdown", (e) => {
        if (e.target.closest("button")) return;
        e.preventDefault();
        const r = panel.getBoundingClientRect();
        const dx = e.clientX - r.left;
        const dy = e.clientY - r.top;
        handle.setPointerCapture(e.pointerId);
        const move = (ev) => place(ev.clientX - dx, ev.clientY - dy);
        const up = () => {
          handle.removeEventListener("pointermove", move);
          handle.removeEventListener("pointerup", up);
          try {
            const r2 = panel.getBoundingClientRect();
            localStorage.setItem(KEY, JSON.stringify({ x: r2.left, y: r2.top }));
          } catch {}
        };
        handle.addEventListener("pointermove", move);
        handle.addEventListener("pointerup", up);
      });
    }

    function show() {
      if (!root || !document.body.contains(root)) build();
      setRunning(running);
    }
    // While running show Stop; when idle show Run again
    function setRunning(on) {
      if (!root) return;
      root.querySelector('[data-a="rerun"]').style.display = on ? "none" : "";
      root.querySelector('[data-a="stop"]').style.display = on ? "" : "none";
    }
    function visible() {
      return !!root && document.body.contains(root);
    }
    function reset() {
      history.length = 0;
      logEl.innerHTML = "";
      statsEl.textContent = "";
    }
    function status(t) {
      if (statusEl) statusEl.textContent = t;
    }
    function stats(s, dry) {
      if (statsEl)
        statsEl.textContent = `Match: ${s.match} (🔖 saved now: ${s.saved || 0}) · ${dry ? "Would dismiss" : "Dismissed"} by AI: ${s.dismissed} · by keyword: ${s.keyword || 0} · by location: ${s.location || 0} · Skipped (dismissed/applied): ${s.skipped} · Errors: ${s.errors}`;
    }
    const history = [];
    function log(head, detail, kind) {
      history.push([head, detail, kind]);
      if (history.length > 200) history.shift();
      render(head, detail, kind);
    }
    function render(head, detail, kind) {
      if (!logEl) return;
      const d = document.createElement("div");
      d.style.margin = "4px 0";
      d.style.color = kind === "ok" ? "#1e8e3e" : kind === "bad" ? "#c5221f" : "#b06000";
      d.innerHTML = `<div style="font-weight:600"></div><div style="color:#555;font-size:12px"></div>`;
      d.children[0].textContent = head;
      d.children[1].textContent = detail || "";
      logEl.prepend(d);
    }
    // Auto next page checkbox (remembered); read from storage if the panel was closed
    function autoNext() {
      if (autoNextEl && root && document.body.contains(root)) return autoNextEl.checked;
      try { return localStorage.getItem("ljf-autonext") === "1"; } catch { return false; }
    }
    return { show, visible, setRunning, reset, status, stats, log, autoNext };
  })();
})();
