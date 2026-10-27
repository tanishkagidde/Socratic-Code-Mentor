
const API = "http://127.0.0.1:8000";
const $ = (id) => document.getElementById(id);

const problemEl = $("problem");
const codeEl = $("code");
const statusEl = $("status");
const resultEl = $("result");
const feedbackEl = $("feedback");

let lastNotes = "";
let importInProgress = false;

const STATUS_LABELS = {
  incomplete: "Code looks incomplete",
  likely_bug: "Likely bug found",
  nearly_correct: "Close — check one detail",
  appears_complete: "Appears complete",
  insufficient_context: "Need more context",
};

function addNote(title, content) {
  const section = document.createElement("section");
  section.className = "note";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const paragraph = document.createElement("p");
  paragraph.textContent = content || "No specific finding.";

  section.append(heading, paragraph);
  feedbackEl.append(section);
}

function addList(title, items) {
  if (!Array.isArray(items) || items.length === 0) return;

  const section = document.createElement("section");
  section.className = "note";

  const heading = document.createElement("h2");
  heading.textContent = title;

  const list = document.createElement("ol");

  items.forEach((item) => {
    const li = document.createElement("li");
    li.textContent = String(item);
    list.append(li);
  });

  section.append(heading, list);
  feedbackEl.append(section);
}

async function checkBackend() {
  try {
    const response = await fetch(`${API}/health`);

    if (!response.ok) throw new Error("Backend unavailable");

    statusEl.textContent = "Backend connected";
    return true;
  } catch (_) {
    statusEl.textContent =
      "Backend offline — start the FastAPI server";
    return false;
  }
}

async function importFromPage({ quiet = false } = {}) {
  if (importInProgress) return false;

  importInProgress = true;

  const button = $("importBtn");
  button.disabled = true;

  if (!quiet) {
    statusEl.textContent = "Reading the current coding page…";
  }

  try {
    const [tab] = await chrome.tabs.query({
      active: true,
      lastFocusedWindow: true,
    });

    if (
      !tab?.id ||
      !/^https:\/\/(www\.)?(leetcode\.com|hackerrank\.com)\//.test(
        tab.url || ""
      )
    ) {
      if (!quiet) {
        throw new Error(
          "Open a LeetCode or HackerRank problem tab first."
        );
      }

      return false;
    }

    const data = await chrome.tabs.sendMessage(tab.id, {
      type: "SCM_EXTRACT_PAGE",
    });

    if (!data?.ok) {
      throw new Error(
        data?.error || "Could not read this page."
      );
    }

    // Automatic import must not overwrite anything already typed.
    // Clicking Import explicitly allows the fields to be refreshed.
    if (data.problem && (!quiet || !problemEl.value.trim())) {
      problemEl.value = data.problem;
    }

    if (data.code && (!quiet || !codeEl.value.trim())) {
      codeEl.value = data.code;
    }

    if (data.language) {
      const option = [...$("language").options].find(
        (item) =>
          item.text.toLowerCase() === data.language.toLowerCase()
      );

      if (option) $("language").value = option.value;
    }

    const missing = [];

    if (!data.problem) missing.push("problem text");
    if (!data.code) missing.push("editor code");

    if (!quiet) {
      statusEl.textContent = missing.length
        ? `Imported what was available; ${missing.join(
            " and "
          )} may need manual paste.`
        : "Imported. Check the problem and code before asking.";
    } else if (
      !missing.length &&
      !problemEl.value.trim() &&
      !codeEl.value.trim()
    ) {
      statusEl.textContent =
        "Page detected — problem and code imported.";
    }

    return true;
  } catch (error) {
    if (!quiet) {
      statusEl.textContent =
        `${error.message} You can paste both fields manually.`;
    }

    return false;
  } finally {
    button.disabled = false;
    importInProgress = false;
  }
}

function renderGuidance(data) {
  feedbackEl.replaceChildren();

  addNote(
    "Assessment",
    STATUS_LABELS[data.status] || "Review your current attempt"
  );

  addNote("Where you may be stuck", data.stuck_point);
  addNote("Evidence in your code", data.evidence);
  addList("Work through these steps", data.steps);
  addNote("Your hint", data.hint);
  addNote("Test to try", data.test_to_try);
  addNote("Complexity estimate", data.complexity);
  addNote("Next action", data.next_action);

  lastNotes = [
    `Assessment: ${STATUS_LABELS[data.status] || data.status}`,
    `Where you may be stuck: ${data.stuck_point}`,
    `Evidence in your code: ${data.evidence}`,
    `Steps:\n${(data.steps || [])
      .map((step, index) => `${index + 1}. ${step}`)
      .join("\n")}`,
    `Hint: ${data.hint}`,
    `Test to try: ${data.test_to_try}`,
    `Complexity: ${data.complexity}`,
    `Next action: ${data.next_action}`,
  ].join("\n\n");

  resultEl.classList.remove("hidden");
}

$("importBtn").addEventListener("click", () => {
  importFromPage();
});

$("askBtn").addEventListener("click", async () => {
  // Refresh the page extraction first, without overwriting typed text.
  await importFromPage({ quiet: true });

  const problem = problemEl.value.trim();
  const code = codeEl.value.trim();

  if (!problem || !code) {
    statusEl.textContent =
      "Add both the problem statement and your current code. " +
      "If automatic import misses them, paste them manually.";
    return;
  }

  const button = $("askBtn");
  button.disabled = true;
  button.textContent = "Analyzing code…";

  statusEl.textContent =
    "Checking your attempt and preparing focused hints…";

  resultEl.classList.add("hidden");

  try {
    const response = await fetch(`${API}/mentor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        problem,
        code,
        language: $("language").value,
        hint_level: Number($("level").value),
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.detail || "Request failed");
    }

    renderGuidance(data);

    statusEl.textContent =
      "Guidance ready. Try the suggested test and verify the result.";
  } catch (error) {
    statusEl.textContent =
      `Could not get guidance: ${error.message}`;
  } finally {
    button.disabled = false;
    button.textContent = "Get guidance";
  }
});

$("copyBtn").addEventListener("click", async () => {
  if (!lastNotes) return;

  try {
    await navigator.clipboard.writeText(lastNotes);
    statusEl.textContent = "Mentor notes copied.";
  } catch (_) {
    statusEl.textContent = "Copy unavailable in this context.";
  }
});

$("clearBtn").addEventListener("click", () => {
  problemEl.value = "";
  codeEl.value = "";

  feedbackEl.replaceChildren();
  resultEl.classList.add("hidden");

  lastNotes = "";
  statusEl.textContent = "Cleared.";
});

checkBackend();

// Try importing the page when the side panel opens.
importFromPage({ quiet: true });
