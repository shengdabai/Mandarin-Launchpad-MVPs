const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

// A small event fixture for application logic. This does not test browser DOM/layout.
function lab(globals = {}) {
  const elements = new Map();
  const listeners = new Map();
  const intervals = new Map();
  const timeouts = new Map();
  const storage = new Map();
  let timerId = 0;
  function element(selector) {
    if (!elements.has(selector)) {
      const handlers = new Map();
      elements.set(selector, {
        value: "", textContent: "", innerHTML: "", className: "", dataset: {}, isConnected: true,
        classList: { add() {}, remove() {}, toggle() {} },
        focus() {}, querySelector: element, querySelectorAll: () => [],
        addEventListener(type, handler) { handlers.set(type, handler); },
        fire(type) { return handlers.get(type)?.({ preventDefault() {}, currentTarget: this }); }
      });
    }
    return elements.get(selector);
  }
  const context = vm.createContext({
    structuredClone, console,
    document: { querySelector: element, body: { dataset: {} } },
    location: { hash: "" },
    history: { replaceState(_state, _title, hash) { context.location.hash = hash; } },
    navigator: {},
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key)
    },
    setTimeout(fn) { const id = ++timerId; timeouts.set(id, fn); return id; },
    clearTimeout: id => timeouts.delete(id),
    setInterval(fn) { const id = ++timerId; intervals.set(id, fn); return id; },
    clearInterval: id => intervals.delete(id),
    ...globals
  });
  context.window = {
    addEventListener: (type, handler) => listeners.set(type, handler),
    scrollTo() {}, confirm: () => true,
    ...(globals.speechSynthesis ? { speechSynthesis: globals.speechSynthesis } : {})
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../app.js"), "utf8"), context);
  const run = code => vm.runInContext(code, context);
  return {
    element, run, intervals, timeouts, storage,
    event(type) { listeners.get(type)?.(); },
    hash(id) { context.location.hash = `#${id}`; listeners.get("hashchange")(); },
    route(id) { run(`route(${JSON.stringify(id)})`); }
  };
}

// All media APIs are fixtures: no permission prompt, device, file, or network access.
function microphone(options = {}) {
  const requests = [], recorders = [], blobs = [], revoked = [], audio = [];
  class Recorder {
    constructor(stream) {
      if (options.constructError) throw new Error("fixture constructor failed");
      this.stream = stream;
      this.state = "inactive";
      this.mimeType = "audio/webm";
      this.events = new Map();
      this.stops = 0;
      recorders.push(this);
    }
    addEventListener(type, callback) { this.events.set(type, callback); }
    start() {
      if (options.startError) throw new Error("fixture start failed");
      this.state = "recording";
    }
    stop() {
      this.stops++;
      if (options.stopError) throw new Error("fixture stop failed");
      this.state = "inactive";
    }
    emit(type, event = {}) { this.events.get(type)?.(event); }
    finish(text = "sample") {
      this.emit("dataavailable", { data: new Blob(text ? [text] : []) });
      this.emit("stop");
    }
  }
  const app = lab({
    Blob,
    MediaRecorder: options.unsupported ? undefined : Recorder,
    navigator: { mediaDevices: { getUserMedia() {
      return new Promise((resolve, reject) => requests.push({ resolve, reject }));
    } } },
    URL: {
      createObjectURL(blob) { blobs.push(blob); return `blob:fixture-${blobs.length}`; },
      revokeObjectURL(url) { revoked.push(url); }
    },
    Audio: class {
      constructor(url) { this.url = url; this.pauses = 0; audio.push(this); }
      play() { return options.playError ? Promise.reject(new Error("fixture blocked playback")) : Promise.resolve(); }
      pause() { this.pauses++; }
    }
  });
  function stream() {
    const track = { stops: 0, stop() { this.stops++; } };
    return { track, getTracks: () => [track] };
  }
  async function begin() {
    app.route("tone");
    const pending = app.element("#record-tone").fire("click");
    const media = stream();
    requests.at(-1).resolve(media);
    await pending;
    return media;
  }
  return { app, requests, recorders, blobs, revoked, audio, stream, begin };
}

test("late microphone permission is released after leaving and returning", async () => {
  const { app, requests, recorders, stream } = microphone();
  app.route("tone");
  const pending = app.element("#record-tone").fire("click");
  app.hash("home");
  app.hash("tone");
  const media = stream();
  requests[0].resolve(media);
  await pending;
  assert.equal(media.track.stops, 1);
  assert.equal(recorders.length, 0);
  assert.equal(app.run("state.completed.tone"), undefined);
});

test("permission and stop finalization cannot be started twice", async () => {
  const { app, requests, recorders, stream } = microphone();
  app.route("tone");
  const pending = app.element("#record-tone").fire("click");
  assert.equal(app.element("#record-tone").disabled, true);
  app.element("#record-tone").fire("click");
  assert.equal(requests.length, 1);
  requests[0].resolve(stream());
  await pending;
  assert.equal(app.element("#record-tone").disabled, false);
  await app.element("#record-tone").fire("click");
  await app.element("#record-tone").fire("click");
  assert.equal(recorders[0].stops, 1);
  assert.equal(requests.length, 1);
  recorders[0].finish();
  assert.equal(app.element("#record-tone").disabled, false);
  assert.equal(app.run("state.completed.tone"), true);
});

for (const failure of ["constructError", "startError"]) {
  test(`${failure} releases the microphone and allows retry`, async () => {
    const options = { [failure]: true };
    const { app, begin, requests } = microphone(options);
    const media = await begin();
    assert.equal(media.track.stops, 1);
    assert.equal(app.element("#record-tone").disabled, false);
    assert.equal(app.run("state.completed.tone"), undefined);
    options[failure] = false;
    const retry = app.element("#record-tone").fire("click");
    requests.at(-1).resolve({ getTracks: () => [] });
    await retry;
    assert.equal(app.element("#record-tone").textContent, "■ Stop");
  });
}

test("permission denial enables retry without saving progress", async () => {
  const { app, requests } = microphone();
  app.route("tone");
  const pending = app.element("#record-tone").fire("click");
  requests[0].reject(new Error("fixture permission denied"));
  await pending;
  assert.equal(app.element("#record-tone").disabled, false);
  assert.equal(app.run("state.completed.tone"), undefined);
});

test("unsupported recorder never requests microphone access", () => {
  const { app, requests } = microphone({ unsupported: true });
  app.route("tone");
  app.element("#record-tone").fire("click");
  assert.equal(requests.length, 0);
  assert.match(app.element("#record-status").textContent, /not available/i);
});

test("old recorder events cannot release or overwrite a newer recording", async () => {
  const { app, begin, requests, stream, recorders, blobs } = microphone();
  await begin();
  await app.element("#record-tone").fire("click");
  recorders[0].finish("first");
  const pending = app.element("#record-tone").fire("click");
  const media = stream();
  requests[1].resolve(media);
  await pending;
  recorders[0].finish("stale");
  assert.equal(blobs.length, 1);
  assert.equal(media.track.stops, 0);
  await app.element("#record-tone").fire("click");
  recorders[1].finish("second");
  assert.equal(await blobs[1].text(), "second");
  assert.equal(media.track.stops, 1);
});

test("late permission denial cannot interrupt the new recording", async () => {
  const { app, requests, stream, recorders } = microphone();
  app.route("tone");
  const old = app.element("#record-tone").fire("click");
  app.hash("home");
  app.hash("tone");
  const next = app.element("#record-tone").fire("click");
  const media = stream();
  requests[1].resolve(media);
  await next;
  requests[0].reject(new Error("fixture late denial"));
  await old;
  assert.equal(media.track.stops, 0);
  assert.equal(recorders[0].state, "recording");
  assert.equal(app.element("#record-tone").textContent, "■ Stop");
});

test("a throwing recorder stop still releases microphone tracks", async () => {
  const { app, begin } = microphone({ stopError: true });
  const media = await begin();
  await app.element("#record-tone").fire("click");
  assert.equal(media.track.stops, 1);
  assert.equal(app.element("#record-tone").disabled, false);
  assert.equal(app.run("state.completed.tone"), undefined);
});

test("a failed second capture keeps the last playable recording", async () => {
  const { app, begin, requests, recorders, revoked } = microphone();
  await begin();
  await app.element("#record-tone").fire("click");
  recorders[0].finish();
  const retry = app.element("#record-tone").fire("click");
  requests[1].reject(new Error("fixture permission denied"));
  await retry;
  assert.deepEqual(revoked, []);
  assert.equal(app.element("#play-recording").disabled, false);
});

test("tone question redraw cancels both pending and active recording", async () => {
  const { app, begin, requests, stream, recorders } = microphone();
  const active = await begin();
  app.run("renderTone()");
  assert.equal(active.track.stops, 1);
  assert.equal(recorders[0].stops, 1);
  const pending = app.element("#record-tone").fire("click");
  app.run("renderTone()");
  const late = stream();
  requests[1].resolve(late);
  await pending;
  assert.equal(late.track.stops, 1);
  assert.equal(recorders.length, 1);
});

test("recorder errors and empty recordings never mark practice complete", async () => {
  for (const type of ["error", "empty"]) {
    const { app, begin, recorders, blobs } = microphone();
    const media = await begin();
    if (type === "error") recorders[0].emit("error");
    else {
      await app.element("#record-tone").fire("click");
      recorders[0].finish("");
    }
    assert.equal(media.track.stops, 1, type);
    assert.equal(blobs.length, 0, type);
    assert.equal(app.run("state.completed.tone"), undefined, type);
    assert.equal(app.element("#record-tone").disabled, false, type);
  }
});

test("pagehide cancels capture and releases a saved playback URL", async () => {
  const { app, begin, recorders, revoked, audio } = microphone();
  const media = await begin();
  app.event("pagehide");
  assert.equal(media.track.stops, 1);
  recorders[0].finish();
  assert.equal(app.run("state.completed.tone"), undefined);
  await begin();
  await app.element("#record-tone").fire("click");
  recorders[1].finish();
  await app.element("#play-recording").fire("click");
  app.event("pagehide");
  assert.equal(audio[0].pauses, 1);
  assert.deepEqual(revoked, ["blob:fixture-1"]);
});

test("playback failure is handled and overlapping playback is paused", async () => {
  const options = { playError: true };
  const { app, begin, recorders, audio } = microphone(options);
  await begin();
  await app.element("#record-tone").fire("click");
  recorders[0].finish();
  await app.element("#play-recording").fire("click");
  assert.match(app.element("#toast").textContent, /playback|play recording/i);
  options.playError = false;
  await app.element("#play-recording").fire("click");
  await app.element("#play-recording").fire("click");
  assert.equal(audio.at(-2).pauses, 1);
  app.hash("home");
  assert.equal(audio.at(-1).pauses, 1);
});

function speech() {
  let voices = [];
  const waiting = new Set(), played = [], active = [];
  const app = lab({
    speechSynthesis: {
      getVoices: () => voices,
      addEventListener(_type, handler) { waiting.add(handler); },
      removeEventListener(_type, handler) { waiting.delete(handler); },
      cancel() { active.length = 0; },
      speak(utterance) { played.push(utterance); active.push(utterance); }
    },
    SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } }
  });
  return { app, played, active, waiting, ready() {
    voices = [{ lang: "zh-CN" }];
    [...waiting].forEach(handler => handler());
  } };
}

test("leaving an exercise cancels pending speech without a late playback", async () => {
  const { app, ready, played } = speech();
  app.route("flow");
  const pending = app.run('speak("测试")');
  app.hash("home");
  ready();
  await pending;
  assert.equal(played.length, 0);
});

test("only the latest speech request plays and voice timers are released", async () => {
  const { app, ready, played, waiting, active } = speech();
  app.route("flow");
  const first = app.run('speak("first")');
  const second = app.run('speak("second")');
  ready();
  await Promise.all([first, second]);
  assert.deepEqual(played.map(item => item.text), ["second"]);
  assert.equal(waiting.size, 0);
  assert.equal(app.timeouts.size, 0);
  app.event("pagehide");
  assert.equal(active.length, 0);
});

test("history navigation stops the conversation timer", () => {
  const app = lab();
  app.route("talk");
  app.element("#start-talk").fire("click");
  assert.equal(app.intervals.size, 1);
  app.hash("home");
  assert.equal(app.intervals.size, 0);
  assert.equal(app.run("talkTimer"), null);
});

test("history navigation cancels sentence advance before returning to the exercise", () => {
  const app = lab();
  app.route("sentence");
  app.run("sentenceAnswer = [...sentenceTasks[0].chunks]");
  app.element("#check-sentence").fire("click");
  const pending = app.run("advanceTimer");
  assert.ok(app.timeouts.has(pending));
  app.hash("home");
  assert.equal(app.timeouts.has(pending), false);
  app.hash("sentence");
  assert.equal(app.run("sentenceQuestion"), 0);
});

test("history navigation stops the recorder and all microphone tracks", async () => {
  const { app, begin, recorders } = microphone();
  const stream = await begin();
  app.hash("home");
  assert.equal(recorders[0].stops, 1);
  assert.equal(stream.track.stops, 1);
  recorders[0].finish("discard this");
  assert.equal(app.run("state.completed.tone"), undefined);
});

test("reset cancels active practice timers", () => {
  const app = lab();
  app.route("talk");
  app.element("#start-talk").fire("click");
  app.element("#reset-data").fire("click");
  assert.equal(app.intervals.size, 0);
});

test("unknown hash and skip link preserve the active route and timer", () => {
  const app = lab();
  app.route("talk");
  app.element("#start-talk").fire("click");
  app.hash("workspace");
  assert.equal(app.run("currentRoute"), "talk");
  assert.equal(app.intervals.size, 1);
});

for (const hash of ["#__proto__", "#constructor", "#toString", "#missing", "#workspace"]) {
  test(`initial hash ${hash} falls back to home`, () => {
    const app = lab({ location: { hash } });
    assert.equal(app.run("currentRoute"), "home");
    assert.match(app.element("#view").innerHTML, /Make your Chinese/);
    app.hash("flow");
    assert.equal(app.run("currentRoute"), "flow");
  });
}

test("a valid initial hash opens the requested exercise", () => {
  const app = lab({ location: { hash: "#cards" } });
  assert.equal(app.run("currentRoute"), "cards");
  assert.match(app.element("#view").innerHTML, /Make a context card/);
});

test("cloze replacement preserves escaped text and replaces only literal targets", () => {
  const app = lab();
  for (const [sentence, target, expected] of [
    ['lt <img src=x onerror="alert(1)"> lt', "lt", '＿＿ &lt;img src=x onerror=&quot;alert(1)&quot;&gt; ＿＿'],
    ["amp & amp", "amp", "＿＿ &amp; ＿＿"],
    ["我说<你好>，再说<你好>。", "<你好>", "我说＿＿，再说＿＿。"],
    ["我今天复习中文，明天复习。", "复习", "我今天＿＿中文，明天＿＿。"]
  ]) {
    app.run(`state.cards = [${JSON.stringify({ sentence, target, meaning: "<example>", due: 0, interval: 1 })}]`);
    app.route("cards");
    const html = app.element("#view").innerHTML;
    assert.ok(html.includes(`<h2 lang="zh-CN">${expected}</h2>`), sentence);
    assert.equal(html.includes("<img"), false);
    assert.equal(html.includes("<example>"), false);
  }
});

for (const field of ["#fix-original", "#fix-corrected", "#fix-reason"]) {
  test(`Fixbook rejects whitespace in ${field}`, () => {
    const app = lab();
    app.route("fixbook");
    app.element("#fix-original").value = "我昨天去超市";
    app.element("#fix-corrected").value = "我昨天去了超市";
    app.element("#fix-reason").value = "Completed event";
    app.element("#fix-source").value = "Teacher";
    app.element(field).value = " \n\t ";
    const count = app.run("state.fixes.length");
    app.element("#fix-form").fire("submit");
    assert.equal(app.run("state.fixes.length"), count);
    assert.equal(app.run("state.completed.fixbook"), undefined);
    assert.equal(app.storage.size, 0);
  });
}

for (const field of ["#card-sentence", "#card-target", "#card-meaning"]) {
  test(`Context Cards rejects whitespace in ${field}`, () => {
    const app = lab();
    app.route("cards");
    app.element("#card-sentence").value = "我今天复习中文。";
    app.element("#card-target").value = "复习";
    app.element("#card-meaning").value = "review";
    app.element(field).value = " \n\t ";
    const count = app.run("state.cards.length");
    app.element("#card-form").fire("submit");
    assert.equal(app.run("state.cards.length"), count);
    assert.equal(app.storage.size, 0);
  });
}

for (const field of ["#proof-action", "#proof-context"]) {
  test(`Proof of Progress rejects whitespace in ${field}`, () => {
    const app = lab();
    app.route("proof");
    app.element("#proof-area").value = "listening";
    app.element("#proof-action").value = "Understood a message";
    app.element("#proof-context").value = "Practice";
    app.element(field).value = " \n\t ";
    app.element("#proof-form").fire("submit");
    assert.equal(app.run("state.proofs.length"), 0);
    assert.equal(app.storage.size, 0);
  });
}

test("valid form submissions still trim, save, and complete the product", () => {
  const app = lab();
  app.route("fixbook");
  for (const [id, value] of Object.entries({ "fix-original": " 我昨天去超市 ", "fix-corrected": " 我昨天去了超市 ", "fix-reason": " Completed event ", "fix-source": "Teacher" })) app.element(`#${id}`).value = value;
  app.element("#fix-form").fire("submit");
  assert.equal(app.run("state.fixes.at(-1).corrected"), "我昨天去了超市");
  app.route("cards");
  app.element("#card-sentence").value = " 我今天复习中文。 ";
  app.element("#card-target").value = " 复习 ";
  app.element("#card-meaning").value = " review ";
  app.element("#card-form").fire("submit");
  assert.equal(app.run("state.cards.at(-1).target"), "复习");
  app.route("proof");
  app.element("#proof-area").value = "listening";
  app.element("#proof-action").value = " Understood a message ";
  app.element("#proof-context").value = " Practice ";
  app.element("#proof-form").fire("submit");
  assert.equal(app.run("state.proofs[0].action"), "Understood a message");
  assert.equal(app.run("state.completed.fixbook && state.completed.cards && state.completed.proof"), true);
});

test("Hanzi recall rejects substrings and accepts each exact meaning", () => {
  const app = lab();
  // Deterministically select each built-in item; exercise its actual answer handler.
  for (const [index, meanings, wrong] of [[0, ["clear", "sunny", "clear / sunny"], "unclear"], [1, ["please", "invite", "please / invite"], "displeased"], [2, ["drink", "to drink"], "drinking"], [3, ["rest", "to rest"], "forest"]]) {
    app.run(`Math.random = () => ${(index + 0.1) / 4}`);
    app.route("hanzi");
    app.element("#hanzi-meaning").value = wrong;
    app.element("#check-hanzi").fire("click");
    assert.equal(app.element("#hanzi-result").className, "result bad", wrong);
    for (const meaning of meanings) {
      app.element("#hanzi-meaning").value = ` ${meaning.toUpperCase()} `;
      app.element("#check-hanzi").fire("click");
      assert.equal(app.element("#hanzi-result").className, "result ok", meaning);
    }
  }
});

test("smoke runner closes its browser after an early test failure", async () => {
  let closed = 0;
  const messages = [];
  const fakeProcess = { env: {}, exitCode: 0 };
  const source = fs.readFileSync(path.join(__dirname, "smoke.cjs"), "utf8");
  await vm.runInNewContext(source, {
    __dirname,
    process: fakeProcess,
    console: { error: message => messages.push(message) },
    require(id) {
      if (id === "playwright") return { chromium: { launch: async () => ({
        newPage: async () => { throw new Error("fixture page creation failed"); },
        close: async () => { closed++; }
      }) } };
      if (id === "node:fs") return { mkdirSync() {} };
      if (id === "node:path") return path;
      throw new Error(`Unexpected dependency: ${id}`);
    }
  });
  assert.equal(fakeProcess.exitCode, 1);
  assert.match(messages[0], /fixture page creation failed/);
  assert.equal(closed, 1);
});
