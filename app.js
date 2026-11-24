let manifestTrials = [];
let studyBlocks = [];
let currentBlockIdx = 0;
let currentTrialIdx = 0;
let trialStartTime = 0;
let participantMeta = {};
let responses = [];

function basename(winOrPosixPath) {
  return winOrPosixPath.split(/[\\/]/).pop();
}

function shuffleArray(arr) {
  const copy = [...arr];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function buildLikertScale(containerId, radioName) {
  const container = document.getElementById(containerId);
  container.innerHTML = "";
  for (let v = 1; v <= 7; v++) {
    const lbl = document.createElement("label");
    lbl.className = "likert-pill";
    lbl.innerHTML = `<input type="radio" name="${radioName}" value="${v}" />${v}`;
    container.appendChild(lbl);
  }
  const naLbl = document.createElement("label");
  naLbl.className = "likert-pill";
  naLbl.innerHTML = `<input type="radio" name="${radioName}" value="Prefer not to answer" />Prefer not to answer`;
  container.appendChild(naLbl);
}

function selectBalancedTrials(allTrials) {
  // Selects 1 TP + 1 FP/FN per scenario + Benign control trials (6 core cases)
  const picked = [];
  const scenarios = ["S1", "S2", "S3", "S4"];
  for (const sc of scenarios) {
    const scTrials = allTrials.filter((t) => t.scenario === sc);
    const tp = scTrials.find((t) => t.alert_type === "TP");
    const nonTp = scTrials.find((t) => t.alert_type === "FP") || scTrials.find((t) => t.alert_type === "FN");
    if (tp) picked.push(tp);
    if (nonTp) picked.push(nonTp);
  }
  const benignTrials = allTrials.filter((t) => t.scenario === "BENIGN");
  picked.push(...benignTrials.slice(0, 2));
  return picked.length > 0 ? picked : allTrials;
}

async function loadManifest() {
  const res = await fetch("./data/testing_manifest.json");
  if (!res.ok) throw new Error("Failed to load ./data/testing_manifest.json");
  const payload = await res.json();
  manifestTrials = payload.trials.map((t) => ({
    ...t,
    web_design_A: `./data/testing/design_A_zscore/${basename(t.design_A_path)}`,
    web_design_B: `./data/testing/design_B_shap/${basename(t.design_B_path)}`,
  }));
}

function showView(viewId) {
  for (const id of ["view-setup", "view-block-intro", "view-trial", "view-complete"]) {
    document.getElementById(id).classList.toggle("hidden", id !== viewId);
  }
}

function startBlockIntro() {
  const block = studyBlocks[currentBlockIdx];
  document.getElementById("progress-indicator").textContent =
    `Block ${currentBlockIdx + 1} of ${studyBlocks.length} (${block.designLabel})`;

  document.getElementById("block-title").textContent =
    `Block ${currentBlockIdx + 1}: ${block.designLabel}`;
  document.getElementById("block-description").textContent = block.description;
  document.getElementById("block-guide").innerHTML = block.guideHtml;
  showView("view-block-intro");
}

function renderCurrentTrial() {
  const block = studyBlocks[currentBlockIdx];
  const trial = block.trials[currentTrialIdx];

  document.getElementById("progress-indicator").textContent =
    `Block ${currentBlockIdx + 1}/${studyBlocks.length} • Alert ${currentTrialIdx + 1} of ${block.trials.length}`;

  document.getElementById("trial-design-tag").textContent = block.designLabel;
  document.getElementById("trial-user-tag").textContent = `User: ${trial.cert_id} (${trial.scenario})`;
  document.getElementById("trial-date-tag").textContent = `Date: ${trial.date} (${trial.day_of_week})`;
  document.getElementById("trial-score").textContent = Number(trial.anomaly_score).toFixed(6);
  document.getElementById("trial-thresh").textContent = Number(trial.threshold).toFixed(6);

  const aboveCutoff = Number(trial.anomaly_score) >= Number(trial.threshold);
  const statusEl = document.getElementById("trial-status");
  statusEl.textContent = aboveCutoff
    ? "Above Baseline Cutoff (Flagged)"
    : "Within Baseline Cutoff (Unflagged / Review)";
  statusEl.style.color = aboveCutoff ? "#b45309" : "#15803d";

  const imgSrc = block.designCode === "A" ? trial.web_design_A : trial.web_design_B;
  document.getElementById("stimulus-img").src = imgSrc;

  // Reset form inputs
  document.querySelectorAll('input[type="radio"]').forEach((el) => (el.checked = false));
  document.getElementById("analyst-notes").value = "";
  document.getElementById("trial-error").classList.add("hidden");

  trialStartTime = performance.now();
  showView("view-trial");
}

function getCheckedValue(name) {
  const el = document.querySelector(`input[name="${name}"]:checked`);
  return el ? el.value : null;
}

function handleTrialSubmit() {
  const decision = getCheckedValue("triage_decision");
  const confidence = getCheckedValue("likert_conf");
  const clarity = getCheckedValue("likert_clar");
  const trust = getCheckedValue("likert_trst");

  if (!decision || !confidence || !clarity || !trust) {
    document.getElementById("trial-error").classList.remove("hidden");
    return;
  }

  const reactionTimeMs = Math.round(performance.now() - trialStartTime);
  const block = studyBlocks[currentBlockIdx];
  const trial = block.trials[currentTrialIdx];

  responses.push({
    participant_id: participantMeta.participantId,
    role: participantMeta.role,
    condition_order: participantMeta.orderLabel,
    block_number: currentBlockIdx + 1,
    design_condition: block.designCode,
    trial_order_in_block: currentTrialIdx + 1,
    trial_id: trial.trial_id,
    scenario: trial.scenario,
    cert_id: trial.cert_id,
    date: trial.date,
    ground_truth_type: trial.alert_type,
    anomaly_score: trial.anomaly_score,
    threshold: trial.threshold,
    triage_decision: decision,
    confidence_rating: confidence,
    clarity_rating: clarity,
    trust_rating: trust,
    reaction_time_ms: reactionTimeMs,
    analyst_notes: document.getElementById("analyst-notes").value.trim(),
    submitted_at_iso: new Date().toISOString(),
  });

  currentTrialIdx++;
  if (currentTrialIdx < block.trials.length) {
    renderCurrentTrial();
  } else {
    currentBlockIdx++;
    currentTrialIdx = 0;
    if (currentBlockIdx < studyBlocks.length) {
      startBlockIntro();
    } else {
      finishStudy();
    }
  }
}

function finishStudy() {
  document.getElementById("progress-indicator").textContent = "Study Completed";
  const answered = responses.filter((r) => r.triage_decision !== "Prefer not to answer");
  const escalations = answered.filter((r) => r.triage_decision === "Escalate").length;
  const meanSec = (
    responses.reduce((acc, r) => acc + r.reaction_time_ms, 0) / Math.max(responses.length, 1) / 1000
  ).toFixed(1);

  document.getElementById("summary-stats").innerHTML = `
    <div class="stat-card"><span>Participant ID</span><strong>${participantMeta.participantId}</strong></div>
    <div class="stat-card"><span>Total Trials Reviewed</span><strong>${responses.length}</strong></div>
    <div class="stat-card"><span>Alerts Escalated</span><strong>${escalations}</strong></div>
    <div class="stat-card"><span>Avg Review Time</span><strong>${meanSec}s</strong></div>
  `;
  showView("view-complete");
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function exportCSV() {
  if (!responses.length) return;
  const headers = Object.keys(responses[0]);
  const rows = responses.map((r) =>
    headers.map((h) => `"${String(r[h] ?? "").replace(/"/g, '""')}"`).join(",")
  );
  const csv = [headers.join(","), ...rows].join("\n");
  downloadFile(`participant_${participantMeta.participantId}_triage_results.csv`, csv, "text/csv;charset=utf-8;");
}

function exportJSON() {
  const payload = {
    participant: participantMeta,
    completed_at: new Date().toISOString(),
    responses,
  };
  downloadFile(
    `participant_${participantMeta.participantId}_triage_results.json`,
    JSON.stringify(payload, null, 2),
    "application/json"
  );
}

document.addEventListener("DOMContentLoaded", async () => {
  buildLikertScale("likert-confidence", "likert_conf");
  buildLikertScale("likert-clarity", "likert_clar");
  buildLikertScale("likert-trust", "likert_trst");

  try {
    await loadManifest();
  } catch (err) {
    const errBox = document.getElementById("setup-error");
    errBox.textContent = `Configuration Error: ${err.message}. Ensure data/testing_manifest.json is present.`;
    errBox.classList.remove("hidden");
  }

  document.getElementById("btn-start").addEventListener("click", () => {
    const pid = document.getElementById("participant-id").value.trim();
    const consent = document.getElementById("consent-check").checked;
    const errBox = document.getElementById("setup-error");

    if (!pid) {
      errBox.textContent = "Please enter a Participant ID before starting.";
      errBox.classList.remove("hidden");
      return;
    }
    if (!consent) {
      errBox.textContent = "Please check the voluntary consent box to proceed.";
      errBox.classList.remove("hidden");
      return;
    }
    errBox.classList.add("hidden");

    const role = document.getElementById("participant-role").value;
    const orderPref = document.getElementById("condition-order").value;
    const scopePref = document.getElementById("trial-subset").value;

    let aFirst = true;
    if (orderPref === "B_FIRST") aFirst = false;
    else if (orderPref === "AUTO") {
      const numMatch = pid.match(/\d+/);
      aFirst = numMatch ? parseInt(numMatch[0], 10) % 2 === 0 : true;
    }

    participantMeta = {
      participantId: pid,
      role,
      orderLabel: aFirst ? "A_then_B" : "B_then_A",
      scope: scopePref,
      startedAt: new Date().toISOString(),
    };

    const baseTrials = scopePref === "BALANCED_12" ? selectBalancedTrials(manifestTrials) : manifestTrials;

    const blockA = {
      designCode: "A",
      designLabel: "Design A — Statistical Baseline Deviation (Z-Score)",
      description:
        "In this block, each alert is explained by showing how far each of the 33 daily behavioral features deviated (in standard deviations, σ) from that user's normal 96-day baseline.",
      guideHtml:
        "<strong>How to read Design A:</strong> Bars extending right (+σ) indicate elevated activity compared to the user's normal baseline; bars extending left (−σ) indicate reduced activity. Values in parentheses show the observed count vs. baseline average.",
      trials: shuffleArray(baseTrials),
    };

    const blockB = {
      designCode: "B",
      designLabel: "Design B — SHAP Feature Attribution Waterfall",
      description:
        "In this block, each alert is explained using SHAP (SHapley Additive exPlanations) values quantifying how much each of the 33 behavioral features pushed the anomaly prediction higher or lower.",
      guideHtml:
        "<strong>How to read Design B:</strong> Red bars (+SHAP) indicate feature values pushing the prediction toward an anomaly alert; blue bars (−SHAP) indicate feature values pushing toward normal behavior.",
      trials: shuffleArray(baseTrials),
    };

    studyBlocks = aFirst ? [blockA, blockB] : [blockB, blockA];
    currentBlockIdx = 0;
    currentTrialIdx = 0;
    startBlockIntro();
  });

  document.getElementById("btn-begin-block").addEventListener("click", renderCurrentTrial);
  document.getElementById("btn-submit-trial").addEventListener("click", handleTrialSubmit);
  document.getElementById("btn-zoom").addEventListener("click", () => {
    document.getElementById("image-wrapper").classList.toggle("zoomed");
  });
  document.getElementById("btn-download-csv").addEventListener("click", exportCSV);
  document.getElementById("btn-download-json").addEventListener("click", exportJSON);
});
