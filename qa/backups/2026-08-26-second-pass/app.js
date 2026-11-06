"use strict";

const STORE_KEY = "mandarin-field-lab-v1";

const products = [
  { id: "flow", no: "01", name: "Flow Decoder", cn: "自然语流解码", problem: "I understand the transcript, but normal speech becomes a blur.", scores: [5, 4, 5], verdict: "真需求 · 中高置信" },
  { id: "tone", no: "02", name: "Tone Mirror", cn: "声调镜", problem: "I can repeat a word, but I cannot hear or keep its tones in a sentence.", scores: [4, 4, 4], verdict: "真需求 · 中高置信" },
  { id: "talk", no: "03", name: "Talk Rehearsal", cn: "对话排练", problem: "The words disappear when a real person starts talking.", scores: [4, 4, 4], verdict: "真需求 · 中高置信" },
  { id: "fixbook", no: "04", name: "Fixbook", cn: "纠错复用本", problem: "I receive corrections, then make the same mistake next week.", scores: [4, 3, 4], verdict: "有条件成立 · 中置信" },
  { id: "sentence", no: "05", name: "Sentence Forge", cn: "语序锻造", problem: "My sentence is understandable, but it still sounds translated from English.", scores: [4, 3, 4], verdict: "真需求 · 中置信" },
  { id: "hanzi", no: "06", name: "Hanzi Hooks", cn: "汉字记忆钩", problem: "I recognise the character today and lose it tomorrow.", scores: [5, 3, 5], verdict: "真需求 · 中高置信" },
  { id: "bridge", no: "07", name: "Content Bridge", cn: "原生内容桥", problem: "Graded readers are easy; native content is suddenly a wall.", scores: [4, 3, 4], verdict: "真需求 · 中高置信" },
  { id: "cards", no: "08", name: "Context Cards", cn: "情境词卡", problem: "I know the card, but I cannot retrieve the word when I need it.", scores: [4, 2, 5], verdict: "有条件成立 · 中置信" },
  { id: "next", no: "09", name: "Next 15", cn: "下一步规划", problem: "I have ten resources and no idea what to do in the next 15 minutes.", scores: [4, 2, 3], verdict: "有条件成立 · 中置信" },
  { id: "proof", no: "10", name: "Proof of Progress", cn: "能力证据", problem: "My streak is alive, but I cannot tell whether my Chinese changed.", scores: [4, 2, 4], verdict: "有条件成立 · 中置信" }
];

const defaultState = {
  completed: {},
  fixes: [
    { original: "我昨天去过超市。", corrected: "我昨天去了超市。", reason: "过 marks experience; 了 marks this completed event.", source: "Teacher", created: "Sample" }
  ],
  cards: [
    { sentence: "开会前我得先准备一下。", target: "准备", meaning: "to prepare", due: 0, interval: 1 }
  ],
  proofs: [],
  weakArea: "listening",
  lastPlan: null
};

let state = loadState();
let currentRoute = location.hash.slice(1) || "home";
let toastTimer = null;
let mediaRecorder = null;
let recordedChunks = [];
let recordingUrl = null;
let talkTimer = null;
let advanceTimer = null;
let activeMediaStream = null;
let recordingAborted = false;
let flowTranscriptLevel = 0;
let toneQuestion = 0;
let sentenceQuestion = 0;
let sentenceAnswer = [];

const view = document.querySelector("#view");
const nav = document.querySelector("#product-nav");
const routeKicker = document.querySelector("#route-kicker");

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE_KEY));
    return saved ? { ...structuredClone(defaultState), ...saved } : structuredClone(defaultState);
  } catch {
    return structuredClone(defaultState);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(state));
    updateProgress();
    return true;
  } catch {
    showToast("This browser could not save local data. Storage may be full or disabled.");
    return false;
  }
}

function escapeHTML(value = "") {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeChinese(value = "") {
  return value.replace(/[\s，。！？、,.!?]/g, "").toLowerCase();
}

function showToast(message) {
  const toast = document.querySelector("#toast");
  toast.textContent = message;
  toast.classList.add("is-visible");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("is-visible"), 2400);
}

function complete(id, message = "Practice saved on this device.") {
  state.completed[id] = true;
  saveState();
  renderNav();
  showToast(message);
}

function updateProgress() {
  const count = products.filter((p) => state.completed[p.id]).length;
  document.querySelector("#progress-count").textContent = `${count}/10`;
}

function renderNav() {
  nav.innerHTML = products.map((p) => `
    <button class="nav-item" type="button" data-route="${p.id}" ${currentRoute === p.id ? 'aria-current="page"' : ""}>
      <span class="nav-no">${p.no}</span>
      <span class="nav-name">${p.name}</span>
      <span class="nav-done ${state.completed[p.id] ? "is-done" : ""}" aria-label="${state.completed[p.id] ? "Tried" : "Not tried"}"></span>
    </button>`).join("");

  nav.querySelectorAll("[data-route]").forEach((button) => {
    button.addEventListener("click", () => route(button.dataset.route));
  });
  updateProgress();
}

function route(id) {
  if (talkTimer) clearInterval(talkTimer);
  if (advanceTimer) clearTimeout(advanceTimer);
  advanceTimer = null;
  stopActiveRecording();
  currentRoute = products.some((p) => p.id === id) ? id : "home";
  location.hash = currentRoute;
  render();
  document.querySelector("#workspace").focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function moduleHero(product, summary) {
  return `
    <header class="module-hero">
      <div>
        <p class="module-code">LAB ${product.no} · ${product.cn}</p>
        <h1>${product.name}</h1>
      </div>
      <div>
        <p class="module-summary">${summary}</p>
        <p class="need-verdict"><strong>${product.verdict}</strong><br>Breadth ${product.scores[0]}/5 · Urgency ${product.scores[1]}/5 · Frequency ${product.scores[2]}/5</p>
      </div>
    </header>`;
}

function evidenceNote(text, href) {
  return `<p class="evidence-note">Evidence boundary: ${text} <a href="${href}" target="_blank" rel="noreferrer">Open source ↗</a></p>`;
}

function renderHome() {
  routeKicker.textContent = "RESEARCH-BACKED PROTOTYPE · 26 AUG 2026";
  view.innerHTML = `
    <header class="hero">
      <div>
        <p class="section-label">10 SMALL PRODUCTS · ONE LEARNING LOOP</p>
        <h1>Make your Chinese <em>usable.</em></h1>
      </div>
      <div class="hero-aside">
        <p>Most learners do not need another course. They need a bridge from <strong>“I studied this”</strong> to <strong>“I can hear and say this now.”</strong></p>
        <div class="button-row">
          <button class="primary" type="button" data-start>Start with listening</button>
          <button class="secondary" type="button" data-route="next">Build my next 15 min</button>
        </div>
      </div>
    </header>
    <section class="manifesto">
      <p class="section-label">THE PRODUCT THESIS</p>
      <blockquote>Decode one real phrase. Rehearse one response. Keep one correction.</blockquote>
    </section>
    <section aria-labelledby="product-heading">
      <p class="section-label" id="product-heading">THE TEN MICRO PRODUCTS</p>
      <div class="product-list">
        ${products.map((p) => `
          <button class="product-row" type="button" data-route="${p.id}">
            <span class="row-no">${p.no}</span>
            <span class="row-title">${p.name}<small> · ${p.cn}</small></span>
            <span class="row-problem">${p.problem}</span>
            <span class="scores" aria-label="Breadth ${p.scores[0]}, urgency ${p.scores[1]}, frequency ${p.scores[2]}">
              <span class="score">B${p.scores[0]}</span><span class="score">U${p.scores[1]}</span><span class="score">F${p.scores[2]}</span>
            </span>
          </button>`).join("")}
      </div>
    </section>
    <p class="evidence-note">This ranking comes from public overseas learner discussions and visible product alternatives. It is not payment evidence. <button class="text-button" type="button" id="home-evidence">Read the research limits</button></p>`;

  view.querySelector("[data-start]").addEventListener("click", () => route("flow"));
  view.querySelectorAll("[data-route]").forEach((button) => button.addEventListener("click", () => route(button.dataset.route)));
  view.querySelector("#home-evidence").addEventListener("click", openEvidence);
}

async function getChineseVoice() {
  let voices = speechSynthesis.getVoices();
  if (!voices.length) {
    voices = await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        speechSynthesis.removeEventListener("voiceschanged", finish);
        resolve(speechSynthesis.getVoices());
      };
      speechSynthesis.addEventListener("voiceschanged", finish, { once: true });
      setTimeout(finish, 700);
    });
  }
  return voices.find((voice) => voice.lang.toLowerCase().startsWith("zh")) || null;
}

async function speak(text, rate = 0.9) {
  if (!("speechSynthesis" in window)) {
    showToast("This browser has no speech synthesis support.");
    return;
  }
  const zhVoice = await getChineseVoice();
  if (!zhVoice) {
    showToast("No Chinese system voice is available. Audio practice is paused rather than using a misleading voice.");
    return;
  }
  speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "zh-CN";
  utterance.rate = rate;
  utterance.voice = zhVoice;
  speechSynthesis.speak(utterance);
}

function renderFlow() {
  const product = products[0];
  const phrase = "你最近工作忙不忙？";
  const chunks = ["你最近", "工作", "忙不忙"];
  const pinyin = ["nǐ zuìjìn", "gōngzuò", "máng bu máng"];
  flowTranscriptLevel = 0;
  routeKicker.textContent = "LISTENING · SEGMENTATION · RETRIEVAL";
  view.innerHTML = moduleHero(product, "Slow is not the goal. Use slow playback to find the seam, then return to natural speed without the transcript.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">ONE PHRASE · THREE PASSES</p>
        <div class="hanzi-display" id="flow-text" lang="zh-CN" aria-live="polite">•••••••••</div>
        <p class="pinyin" id="flow-pinyin" aria-live="polite">Listen before you look.</p>
        <div class="segmented" aria-label="Playback speed">
          <button class="chip" type="button" data-rate="0.65">0.65×</button>
          <button class="chip is-active" type="button" data-rate="0.9">0.9×</button>
          <button class="chip" type="button" data-rate="1.15">1.15×</button>
        </div>
        <div class="button-row">
          <button class="primary" type="button" id="play-flow">▶ Hear the phrase</button>
          <button class="secondary" type="button" id="reveal-flow">Reveal chunks</button>
        </div>
        <div class="field">
          <label for="dictation">Type what you heard</label>
          <input id="dictation" autocomplete="off" lang="zh-CN" placeholder="用中文写下来">
        </div>
        <button class="secondary" type="button" id="check-flow">Check my hearing</button>
        <p class="result" id="flow-result" aria-live="polite"></p>
      </section>
      <aside class="panel accent">
        <p class="section-label">CHUNK MAP</p>
        <h2>Do not chase every sound.</h2>
        <div id="chunk-map" class="list" hidden>
          ${chunks.map((chunk, i) => `<div class="list-item"><strong lang="zh-CN">${chunk}</strong><p class="muted chunk-pinyin" hidden>${pinyin[i]}</p></div>`).join("")}
        </div>
        <p class="muted">MVP limit: browser speech is a stand-in for real recordings. A production test must use learner-selected native audio.</p>
      </aside>
    </div>
    ${evidenceNote("Learners repeatedly report that readable text becomes opaque at normal speed; forum users compensate by pausing, transcribing and replaying short chunks.", "https://www.chinese-forums.com/forums/topic/36333-trying-to-improve-listening-comprehension-speed/")}`;

  let rate = 0.9;
  view.querySelectorAll("[data-rate]").forEach((button) => button.addEventListener("click", () => {
    rate = Number(button.dataset.rate);
    view.querySelectorAll("[data-rate]").forEach((item) => item.classList.toggle("is-active", item === button));
    speak(phrase, rate);
  }));
  view.querySelector("#play-flow").addEventListener("click", () => speak(phrase, rate));
  view.querySelector("#reveal-flow").addEventListener("click", () => {
    flowTranscriptLevel = (flowTranscriptLevel + 1) % 3;
    const text = view.querySelector("#flow-text");
    const py = view.querySelector("#flow-pinyin");
    if (flowTranscriptLevel === 1) { text.textContent = chunks.join(" / "); py.textContent = "Chunk boundaries only"; }
    if (flowTranscriptLevel === 2) { text.textContent = phrase; py.textContent = pinyin.join(" · "); }
    if (flowTranscriptLevel === 0) { text.textContent = "•••••••••"; py.textContent = "Listen before you look."; }
    view.querySelector("#chunk-map").hidden = flowTranscriptLevel === 0;
    view.querySelectorAll(".chunk-pinyin").forEach((item) => { item.hidden = flowTranscriptLevel !== 2; });
  });
  view.querySelector("#check-flow").addEventListener("click", () => {
    const answer = view.querySelector("#dictation").value;
    const result = view.querySelector("#flow-result");
    const ok = normalizeChinese(answer) === normalizeChinese(phrase);
    result.className = `result ${ok ? "ok" : "bad"}`;
    result.textContent = ok ? "Exact match. Now replay at 1.15× with the text hidden." : `Not yet. Compare by chunk: ${chunks.join(" / ")}`;
    if (ok) complete("flow", "Listening pass complete.");
  });
}

const tonePairs = [
  { word: "买", pinyin: "mǎi", meaning: "buy", tone: 3, contrast: "卖", contrastPinyin: "mài", contrastMeaning: "sell", contrastTone: 4 },
  { word: "鱼", pinyin: "yú", meaning: "fish", tone: 2, contrast: "雨", contrastPinyin: "yǔ", contrastMeaning: "rain", contrastTone: 3 },
  { word: "汤", pinyin: "tāng", meaning: "soup", tone: 1, contrast: "糖", contrastPinyin: "táng", contrastMeaning: "sugar", contrastTone: 2 }
];

function renderTone() {
  const product = products[1];
  const pair = tonePairs[toneQuestion % tonePairs.length];
  routeKicker.textContent = "TONE PERCEPTION · RECORD · REFLECT";
  view.innerHTML = moduleHero(product, "Train the contrast inside a meaningful word pair. Record first; machine scoring is deliberately excluded until accuracy is proven.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">HEAR THE CONTRAST</p>
        <div class="tone-chart" aria-label="Five Mandarin tone contours">
          ${["1 high", "2 rise", "3 dip", "4 fall", "0 light"].map((label) => `<div class="tone-bar"><i class="tone-line"></i><span>${label}</span></div>`).join("")}
        </div>
        <p>Which word do you hear?</p>
        <button class="primary" type="button" id="play-tone">▶ Play target</button>
        <div class="segmented">
          <button class="choice-button" type="button" data-tone-choice="a">${pair.word} · ${pair.meaning}</button>
          <button class="choice-button" type="button" data-tone-choice="b">${pair.contrast} · ${pair.contrastMeaning}</button>
        </div>
        <p class="result" id="tone-result" aria-live="polite"></p>
      </section>
      <aside class="panel accent">
        <p class="section-label">YOUR MIRROR</p>
        <h2>Say both. Keep the difference.</h2>
        <p class="hanzi-display" lang="zh-CN">${pair.word} ${pair.contrast}</p>
        <p class="pinyin">${pair.pinyin} / ${pair.contrastPinyin}</p>
        <div class="button-row">
          <button class="primary" type="button" id="record-tone">● Record</button>
          <button class="secondary" type="button" id="play-recording" disabled>Play back</button>
        </div>
        <p class="muted" id="record-status">Your recording stays in this tab and disappears on refresh.</p>
      </aside>
    </div>
    ${evidenceNote("The repeated need is hearing and maintaining contrasts, but learner reports also challenge the reliability of app speech scores.", "https://www.reddit.com/r/ChineseLanguage/comments/jjn306/can_i_trust_hellochinese_speech_recognition/")}`;

  const targetA = toneQuestion % 2 === 0;
  view.querySelector("#play-tone").addEventListener("click", () => speak(targetA ? pair.word : pair.contrast, 0.72));
  view.querySelectorAll("[data-tone-choice]").forEach((button) => button.addEventListener("click", () => {
    const right = (button.dataset.toneChoice === "a") === targetA;
    const result = view.querySelector("#tone-result");
    result.className = `result ${right ? "ok" : "bad"}`;
    result.textContent = right ? `Yes: ${targetA ? pair.pinyin : pair.contrastPinyin}. Now say the pair.` : "Replay. Attend to the direction of the pitch, not volume.";
    if (right) complete("tone", "Tone contrast identified.");
    if (right) {
      view.querySelectorAll("[data-tone-choice]").forEach((item) => { item.disabled = true; });
      advanceTimer = setTimeout(() => {
        if (currentRoute !== "tone") return;
        toneQuestion += 1;
        renderTone();
      }, 1200);
    }
  }));
  view.querySelector("#record-tone").addEventListener("click", toggleRecording);
  view.querySelector("#play-recording").addEventListener("click", () => {
    if (recordingUrl) new Audio(recordingUrl).play();
  });
}

async function toggleRecording() {
  const button = view.querySelector("#record-tone");
  const status = view.querySelector("#record-status");
  if (mediaRecorder?.state === "recording") {
    mediaRecorder.stop();
    button.textContent = "● Record again";
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia) {
    status.textContent = "Recording is not available in this browser. Use localhost in Chrome or Safari.";
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    activeMediaStream = stream;
    recordingAborted = false;
    recordedChunks = [];
    mediaRecorder = new MediaRecorder(stream);
    mediaRecorder.addEventListener("dataavailable", (event) => recordedChunks.push(event.data));
    mediaRecorder.addEventListener("stop", () => {
      stream.getTracks().forEach((track) => track.stop());
      activeMediaStream = null;
      if (recordingAborted) return;
      if (recordingUrl) URL.revokeObjectURL(recordingUrl);
      recordingUrl = URL.createObjectURL(new Blob(recordedChunks, { type: mediaRecorder.mimeType }));
      const playButton = view.querySelector("#play-recording");
      if (playButton) playButton.disabled = false;
      if (status.isConnected) status.textContent = "Recorded. Listen once for the shape, once for the contrast.";
      complete("tone", "Recording captured locally.");
    });
    mediaRecorder.start();
    button.textContent = "■ Stop";
    status.textContent = "Recording… say both words naturally.";
  } catch {
    status.textContent = "Microphone permission was not granted. The rest of the lab still works.";
  }
}

function stopActiveRecording() {
  if (mediaRecorder?.state === "recording") {
    recordingAborted = true;
    mediaRecorder.stop();
  }
  activeMediaStream?.getTracks().forEach((track) => track.stop());
  activeMediaStream = null;
}

const scenarios = [
  { title: "A colleague invites you to dinner", prompt: "Decline politely, give a brief reason, and suggest another day.", scaffold: ["谢谢你邀请我", "不过今天…", "要不我们周…？"], sample: "谢谢你邀请我，不过今天我得加班。要不我们周五一起吃饭？" },
  { title: "Your delivery is late", prompt: "Ask when it will arrive without sounding aggressive.", scaffold: ["你好，我想问一下", "大概什么时候", "麻烦你了"], sample: "你好，我想问一下我的快递大概什么时候能到？麻烦你了。" },
  { title: "You missed part of a sentence", prompt: "Interrupt naturally and ask the speaker to repeat more slowly.", scaffold: ["不好意思", "刚才那句", "可以说慢一点吗"], sample: "不好意思，刚才那句我没听清楚，可以再说慢一点吗？" }
];

function renderTalk() {
  if (talkTimer) clearInterval(talkTimer);
  talkTimer = null;
  const product = products[2];
  const scenario = scenarios[Math.floor(Math.random() * scenarios.length)];
  routeKicker.textContent = "REAL SCENARIO · TIME PRESSURE · SCAFFOLD FADE";
  view.innerHTML = moduleHero(product, "Rehearse the moment before it becomes social. Start with a scaffold, then remove it and try again under light time pressure.") + `
    <div class="lab-grid">
      <section class="panel accent">
        <p class="section-label">SCENARIO</p>
        <h2>${scenario.title}</h2>
        <p class="muted">${scenario.prompt}</p>
        <div class="timer" id="talk-timer">30</div>
        <div class="button-row">
          <button class="primary" type="button" id="start-talk">Start 30 seconds</button>
          <button class="secondary" type="button" id="new-talk">New scenario</button>
        </div>
      </section>
      <aside class="panel">
        <p class="section-label">SCAFFOLD — REMOVE IT</p>
        <div class="list" id="talk-scaffold">
          ${scenario.scaffold.map((line, index) => `<div class="list-item"><span class="muted">0${index + 1}</span> <strong>${line}</strong></div>`).join("")}
        </div>
        <button class="secondary" type="button" id="hide-scaffold">Hide scaffold</button>
        <details class="prompt-card"><summary>Compare with one possible answer</summary><p lang="zh-CN">${scenario.sample}</p></details>
        <p>After speaking, could you finish the job without switching to English?</p>
        <div class="segmented">
          <button class="choice-button" type="button" data-talk-score="again">Not yet</button>
          <button class="choice-button" type="button" data-talk-score="done">Yes, with effort</button>
        </div>
      </aside>
    </div>
    ${evidenceNote("Learners describe years of study alongside fear, shame or freezing in live conversation. Simulation can reduce rehearsal cost, but cannot replace a human transfer test.", "https://www.reddit.com/r/ChineseLanguage/comments/r4q6cn/how_do_i_overcome_increasing_fear_of_speaking/")}`;

  view.querySelector("#start-talk").addEventListener("click", () => {
    clearInterval(talkTimer);
    let remaining = 30;
    const timer = view.querySelector("#talk-timer");
    timer.classList.add("is-running");
    timer.textContent = remaining;
    talkTimer = setInterval(() => {
      remaining -= 1;
      timer.textContent = remaining;
      if (remaining <= 0) {
        clearInterval(talkTimer);
        timer.classList.remove("is-running");
        showToast("Time. Keep the message, not perfect grammar.");
      }
    }, 1000);
  });
  view.querySelector("#new-talk").addEventListener("click", renderTalk);
  view.querySelector("#hide-scaffold").addEventListener("click", (event) => {
    const scaffold = view.querySelector("#talk-scaffold");
    const hidden = scaffold.hidden;
    scaffold.hidden = !hidden;
    event.currentTarget.textContent = hidden ? "Hide scaffold" : "Show scaffold";
  });
  view.querySelectorAll("[data-talk-score]").forEach((button) => button.addEventListener("click", () => {
    if (button.dataset.talkScore === "done") complete("talk", "Conversation rehearsal logged.");
    else showToast("Good diagnosis. Reveal one scaffold line and try again.");
  }));
}

function renderFixbook() {
  const product = products[3];
  routeKicker.textContent = "CORRECTION · SOURCE · RETRIEVAL";
  view.innerHTML = moduleHero(product, "A correction matters only if it changes the next attempt. Store the source, the reason, and a future retrieval cue.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">ADD A REAL CORRECTION</p>
        <form id="fix-form">
          <div class="field"><label for="fix-original">What I said or wrote</label><input id="fix-original" required lang="zh-CN" placeholder="我昨天去过超市。"></div>
          <div class="field"><label for="fix-corrected">Corrected version</label><input id="fix-corrected" required lang="zh-CN" placeholder="我昨天去了超市。"></div>
          <div class="field"><label for="fix-reason">Why it changed</label><input id="fix-reason" required placeholder="过 is experience; 了 is this completed event."></div>
          <div class="field"><label for="fix-source">Correction source</label><select id="fix-source"><option>Teacher</option><option>Native-speaking partner</option><option>Dictionary / reference</option><option>AI — unverified</option></select></div>
          <button class="primary" type="submit">Save to my fixbook</button>
        </form>
      </section>
      <aside class="panel accent">
        <p class="section-label">RECALL, DON'T REREAD</p>
        <h2>${state.fixes.length} corrections kept</h2>
        <div class="list">
          ${state.fixes.slice().reverse().map((fix) => `
            <details class="list-item">
              <summary>${escapeHTML(fix.original)}</summary>
              <div class="correction" lang="zh-CN"><p>${escapeHTML(fix.original)}</p><span class="arrow">→</span><p><strong>${escapeHTML(fix.corrected)}</strong></p></div>
              <p class="muted">${escapeHTML(fix.reason)} · ${escapeHTML(fix.source)}</p>
            </details>`).join("")}
        </div>
      </aside>
    </div>
    ${evidenceNote("Advanced and heritage learners explicitly ask for speaking/writing correction and for incorporating corrections into later output. AI-only corrections remain a trust risk.", "https://www.chinese-forums.com/forums/topic/54104-resources-for-advanced-heritage-learners/")}`;

  view.querySelector("#fix-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.fixes.push({
      original: view.querySelector("#fix-original").value.trim(),
      corrected: view.querySelector("#fix-corrected").value.trim(),
      reason: view.querySelector("#fix-reason").value.trim(),
      source: view.querySelector("#fix-source").value,
      created: new Date().toISOString()
    });
    complete("fixbook", "Correction saved. It stays on this device.");
    renderFixbook();
  });
}

const sentenceTasks = [
  { english: "I went to Beijing by train last year.", chunks: ["我", "去年", "坐火车", "去了", "北京"], answer: "我去年坐火车去了北京", note: "Time comes early; the manner comes before the main verb; destination follows 去." },
  { english: "She has already studied Chinese for three years.", chunks: ["她", "已经", "学", "三年", "中文", "了"], answer: "她已经学三年中文了", note: "已经 frames the duration; sentence-final 了 marks the current new state." },
  { english: "Could you speak a little more slowly?", chunks: ["你", "可以", "说", "慢一点", "吗"], answer: "你可以说慢一点吗", note: "The degree phrase 慢一点 follows the verb 说." }
];

function renderSentence() {
  const product = products[4];
  const task = sentenceTasks[sentenceQuestion % sentenceTasks.length];
  sentenceAnswer = [];
  const shuffled = [...task.chunks].sort(() => Math.random() - .5);
  routeKicker.textContent = "WORD ORDER · RECONSTRUCTION · EXPLANATION";
  view.innerHTML = moduleHero(product, "Build the sentence from meaning-bearing chunks. The explanation appears after retrieval, not before it.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">BUILD IT IN CHINESE</p>
        <h2>${task.english}</h2>
        <div class="segmented" id="sentence-bank">
          ${shuffled.map((chunk, index) => `<button class="chip" type="button" data-chunk-index="${index}" data-chunk="${escapeHTML(chunk)}">${chunk}</button>`).join("")}
        </div>
        <div class="sentence-zone" id="sentence-zone" lang="zh-CN" aria-label="Your sentence" aria-live="polite">Choose chunks above.</div>
        <div class="button-row">
          <button class="secondary" type="button" id="undo-sentence">Undo</button>
          <button class="primary" type="button" id="check-sentence">Check structure</button>
        </div>
        <p class="result" id="sentence-result" aria-live="polite"></p>
      </section>
      <aside class="panel accent">
        <p class="section-label">STRUCTURE, NOT TRANSLATION</p>
        <h2 id="sentence-explanation">Retrieve first.</h2>
        <p class="muted">Each chunk carries one job. Say the completed answer aloud after checking.</p>
      </aside>
    </div>
    ${evidenceNote("Learners with strong passive Chinese still report assembling sentences in an English-shaped order; generic grammar explanations alone are often rejected as abstract.", "https://www.reddit.com/r/ChineseLanguage/comments/q8nulb/why_does_chinese_grammar_explanations_seem_to/")}`;

  view.querySelectorAll("[data-chunk]").forEach((button) => button.addEventListener("click", () => {
    sentenceAnswer.push(button.dataset.chunk);
    button.disabled = true;
    updateSentenceZone();
  }));
  view.querySelector("#undo-sentence").addEventListener("click", () => {
    const removed = sentenceAnswer.pop();
    const disabled = [...view.querySelectorAll("[data-chunk][disabled]")];
    const button = disabled.reverse().find((item) => item.dataset.chunk === removed);
    if (button) button.disabled = false;
    updateSentenceZone();
  });
  view.querySelector("#check-sentence").addEventListener("click", () => {
    const result = view.querySelector("#sentence-result");
    const answer = sentenceAnswer.join("");
    const ok = normalizeChinese(answer) === normalizeChinese(task.answer);
    result.className = `result ${ok ? "ok" : "bad"}`;
    result.textContent = ok ? `Correct: ${task.answer}` : "The pieces are right, but the information order is not. Undo from the end and try again.";
    view.querySelector("#sentence-explanation").textContent = ok ? task.note : "Think: who → when → how → action → where.";
    if (ok) {
      complete("sentence", "Sentence reconstructed.");
      view.querySelectorAll("[data-chunk], #undo-sentence, #check-sentence").forEach((item) => { item.disabled = true; });
      advanceTimer = setTimeout(() => {
        if (currentRoute !== "sentence") return;
        sentenceQuestion += 1;
        renderSentence();
      }, 1800);
    }
  });
}

function updateSentenceZone() {
  const zone = view.querySelector("#sentence-zone");
  zone.innerHTML = sentenceAnswer.length ? sentenceAnswer.map((chunk) => `<span class="answer-chip">${escapeHTML(chunk)}</span>`).join("") : "Choose chunks above.";
}

const hanziItems = [
  { char: "晴", pinyin: "qíng", meaning: "clear / sunny", parts: "日 sun + 青 sound clue", contrast: "情 qíng · feeling", cue: "A clear day shows the sun 日." },
  { char: "请", pinyin: "qǐng", meaning: "please / invite", parts: "讠speech + 青 sound clue", contrast: "清 qīng · clear", cue: "A polite request uses speech 讠." },
  { char: "喝", pinyin: "hē", meaning: "to drink", parts: "口 mouth + 曷 sound clue", contrast: "渴 kě · thirsty", cue: "Drinking uses the mouth 口; thirst needs water 氵." },
  { char: "休", pinyin: "xiū", meaning: "to rest", parts: "亻person + 木 tree", contrast: "体 tǐ · body", cue: "A person leans against a tree." }
];

function renderHanzi() {
  const product = products[5];
  const item = hanziItems[Math.floor(Math.random() * hanziItems.length)];
  routeKicker.textContent = "COMPONENTS · CONFUSABLES · ACTIVE RECALL";
  view.innerHTML = moduleHero(product, "Use a component as a retrieval hook, then discriminate a confusable neighbor. Handwriting is optional; recall is not.") + `
    <div class="lab-grid">
      <section class="panel accent">
        <p class="section-label">LOOK FOR TEN SECONDS</p>
        <div class="hanzi-display" lang="zh-CN">${item.char}</div>
        <p class="pinyin">${item.pinyin}</p>
        <h2>${item.meaning}</h2>
        <p>${item.parts}</p>
        <p class="muted">Hook: ${item.cue}</p>
        <button class="primary" type="button" id="hide-hanzi">Hide and retrieve</button>
      </section>
      <aside class="panel">
        <p class="section-label">CONFUSABLE NEIGHBOR</p>
        <h2>${item.char} ≠ ${item.contrast}</h2>
        <div class="field"><label for="hanzi-meaning">Without looking: what does ${item.char} mean?</label><input id="hanzi-meaning" autocomplete="off"></div>
        <button class="secondary" type="button" id="check-hanzi">Check recall</button>
        <p class="result" id="hanzi-result"></p>
      </aside>
    </div>
    ${evidenceNote("Learners repeatedly describe high character attrition and build their own combinations of SRS, components, mnemonics and contextual exposure. Existing mature tools are strong counterevidence to a generic flashcard clone.", "https://www.chinese-forums.com/forums/topic/17716-memorising-retaining-chinese-characters/")}`;

  view.querySelector("#hide-hanzi").addEventListener("click", (event) => {
    const display = view.querySelector(".panel.accent .hanzi-display");
    display.textContent = display.textContent === "?" ? item.char : "?";
    event.currentTarget.textContent = display.textContent === "?" ? "Reveal character" : "Hide and retrieve";
  });
  view.querySelector("#check-hanzi").addEventListener("click", () => {
    const answer = view.querySelector("#hanzi-meaning").value.toLowerCase();
    const terms = item.meaning.toLowerCase().split(/\s*\/\s*/);
    const accepted = terms.flatMap((term) => [term, term.replace(/^to\s+/, "")]);
    const ok = Boolean(answer.trim()) && accepted.some((term) => term.length >= 3 && answer.includes(term));
    const result = view.querySelector("#hanzi-result");
    result.className = `result ${ok ? "ok" : "bad"}`;
    result.textContent = ok ? `Yes. ${item.cue}` : `Answer: ${item.meaning}. Rebuild it from ${item.parts}.`;
    if (ok) complete("hanzi", "One character retrieved from its components.");
  });
}

const commonChars = new Set("的一是在不了有人我他这中大来上个们到说国为子和你地出道也时年得就那要下以生会自着去之过家学对可她里后小么心多天而能好都然没日于起还发成事只作当想看文无开手十用主行方又如前所本见经头面公同三已老从动两长知民样现分将外但身些与高意把法回明问力工等名次门间常其并位再很新因定被".split(""));

function renderBridge() {
  const product = products[6];
  const sample = "最近我开始坐地铁上班。刚开始的时候，我总是担心坐错方向，后来发现只要看清楚站名就没问题。现在我会利用路上的时间听中文播客。";
  routeKicker.textContent = "YOUR TEXT · SEGMENT · REVEAL ON DEMAND";
  view.innerHTML = moduleHero(product, "Bring the article you actually want to read. The bridge segments it, estimates character load, and keeps help one tap away.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">PASTE REAL CHINESE</p>
        <div class="field"><label for="bridge-input">Article, message, caption or transcript</label><textarea id="bridge-input" lang="zh-CN">${sample}</textarea></div>
        <button class="primary" type="button" id="analyze-bridge">Build my bridge</button>
        <div id="bridge-metrics"></div>
      </section>
      <aside class="panel accent">
        <p class="section-label">READ ONE SENTENCE AT A TIME</p>
        <div id="bridge-output"><p class="muted">Your segmented text will appear here. Tap a sentence to reveal support.</p></div>
      </aside>
    </div>
    ${evidenceNote("Learners describe a sharp jump in vocabulary and sentence length between graded readers and native text. Existing graded libraries validate the job but argue against building another fixed content catalog.", "https://www.reddit.com/r/ChineseLanguage/comments/12vzknn/how_in_the_world_do_you_get_to_nativelevel_texts/")}`;

  view.querySelector("#analyze-bridge").addEventListener("click", analyzeBridge);
}

function analyzeBridge() {
  const text = view.querySelector("#bridge-input").value.trim();
  if (!text) { showToast("Paste some Chinese first."); return; }
  const chars = [...text].filter((char) => /[\u3400-\u9fff]/.test(char));
  const unique = new Set(chars);
  const unfamiliarProxy = [...unique].filter((char) => !commonChars.has(char));
  if (!chars.length) { showToast("Add Chinese text before building a content bridge."); return; }
  const sentences = (text.match(/[^。！？!?]+[。！？!?]?/g) || []).map((item) => item.trim()).filter(Boolean);
  const load = unique.size ? Math.round((unfamiliarProxy.length / unique.size) * 100) : 0;
  view.querySelector("#bridge-metrics").innerHTML = `<div class="metric-strip"><div class="metric"><strong>${sentences.length}</strong><span>sentence chunks</span></div><div class="metric"><strong>${unique.size}</strong><span>unique Hanzi</span></div><div class="metric"><strong>${load}%</strong><span>uncommon-character proxy</span></div></div><p class="muted">This is a rough character-frequency proxy, not an HSK level or comprehension score.</p>`;
  view.querySelector("#bridge-output").innerHTML = `<div class="split-text">${sentences.map((sentence, index) => `<button class="sentence-line text-button" type="button" data-sentence="${index}"><strong>${escapeHTML(sentence)}</strong><span class="assist">Pause at punctuation. Circle the main verb. Unknown-character candidates: ${escapeHTML([...new Set([...sentence].filter((char) => unfamiliarProxy.includes(char)))].join("、") || "none")}</span></button>`).join("")}</div>`;
  view.querySelectorAll("[data-sentence]").forEach((button) => button.addEventListener("click", () => button.classList.toggle("is-open")));
  complete("bridge", "A personal text bridge was built.");
}

function renderCards() {
  const product = products[7];
  const dueCards = state.cards.filter((card) => card.due <= Date.now());
  const active = dueCards[0] || null;
  const nextCard = state.cards.filter((card) => card.due > Date.now()).sort((a, b) => a.due - b.due)[0] || null;
  routeKicker.textContent = "REAL CONTEXT · CLOZE · SPACED RETRIEVAL";
  view.innerHTML = moduleHero(product, "Only make a card from a sentence you wanted to understand or say. The context is the product; the scheduling is plumbing.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">MAKE A CONTEXT CARD</p>
        <form id="card-form">
          <div class="field"><label for="card-sentence">Real sentence</label><input id="card-sentence" required lang="zh-CN" placeholder="开会前我得先准备一下。"></div>
          <div class="field"><label for="card-target">Target word exactly as used</label><input id="card-target" required lang="zh-CN" placeholder="准备"></div>
          <div class="field"><label for="card-meaning">Meaning in this context</label><input id="card-meaning" required placeholder="to prepare"></div>
          <button class="primary" type="submit">Create cloze card</button>
        </form>
      </section>
      <aside class="panel accent">
        <p class="section-label">DUE NOW · ${dueCards.length}</p>
        ${active ? `<h2 lang="zh-CN">${escapeHTML(active.sentence).split(escapeHTML(active.target)).join("＿＿")}</h2><p class="muted">Retrieve the missing Chinese word for “${escapeHTML(active.meaning)}”.</p><details class="prompt-card"><summary>Reveal</summary><p class="hanzi-display" lang="zh-CN">${escapeHTML(active.target)}</p></details><div class="segmented"><button class="choice-button" type="button" data-card-rating="again">Again</button><button class="choice-button" type="button" data-card-rating="good">Got it</button></div>` : nextCard ? `<h2>Nothing is due.</h2><p class="muted">Next review: ${new Date(nextCard.due).toLocaleDateString()}. Scheduling stays unchanged until then.</p>` : `<p>No cards yet. Create one from a real sentence.</p>`}
      </aside>
    </div>
    ${evidenceNote("SRS use is widespread, but users with thousands of cards still report a gap between vocabulary review and real comprehension or output. A generic deck would have weak differentiation.", "https://www.chinese-forums.com/forums/topic/54104-resources-for-advanced-heritage-learners/")}`;

  view.querySelector("#card-form").addEventListener("submit", (event) => {
    event.preventDefault();
    const sentence = view.querySelector("#card-sentence").value.trim();
    const target = view.querySelector("#card-target").value.trim();
    if (!sentence.includes(target)) { showToast("The target word must appear exactly in the sentence."); return; }
    state.cards.push({ sentence, target, meaning: view.querySelector("#card-meaning").value.trim(), due: 0, interval: 1 });
    complete("cards", "Context card created.");
    renderCards();
  });
  view.querySelectorAll("[data-card-rating]").forEach((button) => button.addEventListener("click", () => {
    const rating = button.dataset.cardRating;
    active.interval = rating === "good" ? Math.min((active.interval || 1) * 2, 30) : 1;
    active.due = Date.now() + active.interval * 86400000;
    complete("cards", rating === "good" ? `Next review in ${active.interval} days.` : "Card returns tomorrow.");
    renderCards();
  }));
}

const planCatalog = {
  listening: ["Decode one 10–20 second native phrase", "Write what you hear before opening subtitles", "Replay once at natural speed"],
  tones: ["Contrast one tone pair", "Record the pair inside a short phrase", "Note the weakest transition"],
  speaking: ["Choose one real scenario", "Speak for 30 seconds with a scaffold", "Repeat without the scaffold"],
  grammar: ["Rebuild three sentences from chunks", "Explain one word-order choice", "Say a new sentence with the same frame"],
  characters: ["Retrieve five confusable characters", "Name one component hook for each", "Use two in a real message"]
};

function renderNext() {
  const product = products[8];
  routeKicker.textContent = "ONE BOTTLENECK · FIFTEEN MINUTES · NO RESOURCE SHOPPING";
  view.innerHTML = moduleHero(product, "A plan is useful only when it starts now. Pick the bottleneck; receive one closed 15-minute loop.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">WHAT FAILED MOST RECENTLY?</p>
        <div class="segmented" id="weak-area">
          ${Object.keys(planCatalog).map((area) => `<button class="choice-button ${state.weakArea === area ? "is-active" : ""}" type="button" data-area="${area}">${area}</button>`).join("")}
        </div>
        <div class="field"><label for="plan-context">Real context for today's practice</label><input id="plan-context" placeholder="Tomorrow's team lunch / a podcast / HSK practice"></div>
        <button class="primary" type="button" id="make-plan">Build my next 15</button>
      </section>
      <aside class="panel accent" id="plan-output">
        ${state.lastPlan ? planMarkup(state.lastPlan) : `<p class="section-label">EMPTY STATE</p><h2>No curriculum. One next action.</h2><p class="muted">Choose the failure that cost you something most recently.</p>`}
      </aside>
    </div>
    ${evidenceNote("Self-learners repeatedly request roadmaps amid many apps and resources, but free plans are abundant. The condition for value is immediate behavior, not more recommendations.", "https://www.reddit.com/r/ChineseLanguage/comments/hh2rd4/help_with_developing_a_study_plan/")}`;

  view.querySelectorAll("[data-area]").forEach((button) => button.addEventListener("click", () => {
    state.weakArea = button.dataset.area;
    saveState();
    view.querySelectorAll("[data-area]").forEach((item) => item.classList.toggle("is-active", item === button));
  }));
  view.querySelector("#make-plan").addEventListener("click", () => {
    const context = view.querySelector("#plan-context").value.trim() || "your next real Chinese moment";
    state.lastPlan = { area: state.weakArea, context, tasks: planCatalog[state.weakArea], created: new Date().toISOString() };
    complete("next", "Your 15-minute loop is ready.");
    view.querySelector("#plan-output").innerHTML = planMarkup(state.lastPlan);
  });
}

function planMarkup(plan) {
  const times = ["0–5", "5–11", "11–15"];
  return `<p class="section-label">TODAY · ${escapeHTML(plan.area)}</p><h2>${escapeHTML(plan.context)}</h2>${plan.tasks.map((task, index) => `<div class="plan-block"><span class="plan-time">${times[index]} min</span><p>${escapeHTML(task)}</p></div>`).join("")}<p class="muted">Stop at 15 minutes. Record one ability proof, then leave.</p>`;
}

function renderProof() {
  const product = products[9];
  routeKicker.textContent = "BEHAVIOR · DATE · EVIDENCE";
  const counts = state.proofs.reduce((acc, proof) => { acc[proof.area] = (acc[proof.area] || 0) + 1; return acc; }, {});
  view.innerHTML = moduleHero(product, "Do not ask whether you felt productive. Record one thing you can now do in Chinese that you could not reliably do before.") + `
    <div class="lab-grid">
      <section class="panel">
        <p class="section-label">ADD ABILITY EVIDENCE</p>
        <form id="proof-form">
          <div class="field"><label for="proof-area">Ability</label><select id="proof-area">${Object.keys(planCatalog).map((area) => `<option>${area}</option>`).join("")}</select></div>
          <div class="field"><label for="proof-action">What can you do now?</label><textarea id="proof-action" required placeholder="I understood a 20-second voice message without asking for the text."></textarea></div>
          <div class="field"><label for="proof-context">Evidence or context</label><input id="proof-context" required placeholder="WeChat message from a colleague, 26 Aug"></div>
          <button class="primary" type="submit">Keep this proof</button>
        </form>
        <button class="text-button" type="button" id="export-proof">Copy my progress as JSON</button>
      </section>
      <aside class="panel accent">
        <p class="section-label">ABILITY LEDGER · ${state.proofs.length}</p>
        <div class="metric-strip proof-metrics">${["listening", "tones", "speaking", "grammar", "characters"].map((area) => `<div class="metric"><strong>${counts[area] || 0}</strong><span>${area}</span></div>`).join("")}</div>
        <div class="list">
          ${state.proofs.length ? state.proofs.slice().reverse().map((proof) => `<div class="list-item"><strong>${escapeHTML(proof.action)}</strong><p class="muted">${escapeHTML(proof.area)} · ${escapeHTML(proof.context)} · ${new Date(proof.created).toLocaleDateString()}</p></div>`).join("") : `<p class="muted">No proof yet. A completed lesson is not automatically an ability change.</p>`}
        </div>
      </aside>
    </div>
    ${evidenceNote("Learners report motivation dropping when accumulated review feels like a heavy backpack. This prototype tracks observable capability, not an unbroken streak.", "https://www.chinese-forums.com/forums/topic/57637-what-is-a-realistic-timetable-for-learning-chinese/")}`;

  view.querySelector("#proof-form").addEventListener("submit", (event) => {
    event.preventDefault();
    state.proofs.push({
      area: view.querySelector("#proof-area").value,
      action: view.querySelector("#proof-action").value.trim(),
      context: view.querySelector("#proof-context").value.trim(),
      created: new Date().toISOString()
    });
    complete("proof", "Ability proof added to your local ledger.");
    renderProof();
  });
  view.querySelector("#export-proof").addEventListener("click", async () => {
    const payload = JSON.stringify({ exported: new Date().toISOString(), proofs: state.proofs }, null, 2);
    try { await navigator.clipboard.writeText(payload); showToast("Progress JSON copied."); }
    catch { showToast("Clipboard unavailable. Try from localhost in a modern browser."); }
  });
}

function openEvidence() {
  window.open("report-source.md", "_blank", "noopener");
}

function render() {
  renderNav();
  const renderers = {
    home: renderHome,
    flow: renderFlow,
    tone: renderTone,
    talk: renderTalk,
    fixbook: renderFixbook,
    sentence: renderSentence,
    hanzi: renderHanzi,
    bridge: renderBridge,
    cards: renderCards,
    next: renderNext,
    proof: renderProof
  };
  (renderers[currentRoute] || renderHome)();
}

document.querySelector("#open-evidence").addEventListener("click", openEvidence);
document.querySelector("#reset-data").addEventListener("click", () => {
  const confirmed = window.confirm("Delete only this prototype's local learning data?");
  if (!confirmed) return;
  localStorage.removeItem(STORE_KEY);
  state = structuredClone(defaultState);
  render();
  showToast("Local prototype data reset.");
});
window.addEventListener("hashchange", () => {
  const id = location.hash.slice(1) || "home";
  const valid = id === "home" || products.some((product) => product.id === id);
  if (!valid) {
    history.replaceState(null, "", `#${currentRoute}`);
    return;
  }
  if (id !== currentRoute) { currentRoute = id; render(); }
});

render();
