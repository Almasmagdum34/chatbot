const form = document.querySelector("#chat-form");
const input = document.querySelector("#message-input");
const sendButton = document.querySelector("#send-button");
const sendLabel = sendButton.querySelector(".send-label");
const stopButton = document.querySelector("#stop-generation");
const welcome = document.querySelector("#welcome");
const messagesElement = document.querySelector("#messages");
const errorElement = document.querySelector("#error-message");
const profileDialog = document.querySelector("#profile-dialog");
const profileForm = document.querySelector("#profile-form");
const profileStorageKey = "orbit-study-profile-v1";
const conversationStorageKey = "orbit-study-conversation-v1";
const chatsStorageKey = "orbit-study-chats-v1";
const activeChatStorageKey = "orbit-study-active-chat-v1";
const themeStorageKey = "orbit-study-theme-v1";
const defaultProfile = {
  gradeLevel: "Independent learner",
  subjects: "",
  explanationStyle: "Step by step",
};

let profile = { ...defaultProfile };
let messages = [];
let chats = [];
let activeChatId = null;
let previousInteractionId = null;
let currentMode = "tutor";
let apiStatus = "checking";
let activeController = null;
let activeRequest = null;

try {
  const savedProfile = JSON.parse(localStorage.getItem(profileStorageKey) ?? "null");
  if (savedProfile && typeof savedProfile === "object") profile = { ...profile, ...savedProfile };
} catch {
  localStorage.removeItem(profileStorageKey);
}

try {
  const savedChats = JSON.parse(localStorage.getItem(chatsStorageKey) ?? "[]");
  chats = Array.isArray(savedChats) ? savedChats.filter((chat) => chat && typeof chat.id === "string") : [];
  activeChatId = localStorage.getItem(activeChatStorageKey);

  if (chats.length === 0) {
    const savedConversation = JSON.parse(localStorage.getItem(conversationStorageKey) ?? "null");
    if (Array.isArray(savedConversation?.messages) && savedConversation.messages.length) {
      const firstQuestion = savedConversation.messages.find((message) => message.role === "user")?.text ?? "";
      activeChatId = createChatId();
      chats.push({
        id: activeChatId,
        title: firstQuestion.slice(0, 48) || "Previous study chat",
        messages: savedConversation.messages,
        interactionId: savedConversation.interactionId ?? null,
        mode: savedConversation.mode ?? "tutor",
        updatedAt: Date.now(),
      });
    }
  }

  const activeChat = chats.find((chat) => chat.id === activeChatId) ?? chats[0];
  if (activeChat) {
    activeChatId = activeChat.id;
    messages = Array.isArray(activeChat.messages) ? activeChat.messages : [];
    previousInteractionId = activeChat.interactionId ?? null;
    currentMode = ["tutor", "practice", "homework"].includes(activeChat.mode) ? activeChat.mode : "tutor";
  }
} catch {
  localStorage.removeItem(chatsStorageKey);
  localStorage.removeItem(activeChatStorageKey);
}

const savedTheme = localStorage.getItem(themeStorageKey);
document.documentElement.dataset.theme = savedTheme === "dark" ? "dark" : "light";

function updateProfileSummary() {
  document.querySelector("#profile-level").textContent = profile.gradeLevel;
  document.querySelector("#profile-subjects").textContent = profile.subjects || "Add your subjects";
}

function saveConversation() {
  if (!activeChatId && messages.length === 0) return;
  if (!activeChatId) activeChatId = createChatId();
  const firstQuestion = messages.find((message) => message.role === "user")?.text ?? "";
  const activeChat = {
    id: activeChatId,
    title: firstQuestion.replace(/\s+/g, " ").slice(0, 48) || "New study chat",
    messages,
    interactionId: previousInteractionId,
    mode: currentMode,
    updatedAt: Date.now(),
  };
  chats = [activeChat, ...chats.filter((chat) => chat.id !== activeChatId)]
    .sort((left, right) => right.updatedAt - left.updatedAt);
  localStorage.setItem(chatsStorageKey, JSON.stringify(chats));
  localStorage.setItem(activeChatStorageKey, activeChatId);
  renderChatHistory();
}

function createChatId() {
  return globalThis.crypto?.randomUUID?.() ?? `chat-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function renderChatHistory() {
  const historyList = document.querySelector("#history-list");
  if (!historyList) return;
  historyList.replaceChildren();
  if (!chats.length) {
    const empty = document.createElement("p");
    empty.className = "history-empty";
    empty.textContent = "Your chats will appear here.";
    historyList.append(empty);
    return;
  }

  for (const chat of chats) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = `history-item${chat.id === activeChatId ? " is-active" : ""}`;
    button.textContent = chat.title || "New study chat";
    button.title = chat.title || "New study chat";
    button.addEventListener("click", () => void openChat(chat.id));
    historyList.append(button);
  }
}

async function waitForCurrentRequest() {
  if (!activeRequest) return;
  activeController?.abort();
  await activeRequest;
}

async function openChat(chatId) {
  if (chatId === activeChatId) return;
  await waitForCurrentRequest();
  const chat = chats.find((item) => item.id === chatId);
  if (!chat) return;
  activeChatId = chat.id;
  messages = Array.isArray(chat.messages) ? chat.messages : [];
  previousInteractionId = chat.interactionId ?? null;
  currentMode = ["tutor", "practice", "homework"].includes(chat.mode) ? chat.mode : "tutor";
  selectMode(currentMode);
  renderConversation();
  renderChatHistory();
  closeSidebar();
}

async function startNewChat() {
  await waitForCurrentRequest();
  activeChatId = null;
  messages = [];
  previousInteractionId = null;
  currentMode = "tutor";
  messagesElement.replaceChildren();
  welcome.hidden = false;
  errorElement.hidden = true;
  selectMode(currentMode);
  renderChatHistory();
  closeSidebar();
  input.focus();
}

function closeSidebar() {
  document.body.classList.remove("sidebar-open");
  document.querySelector("#toggle-sidebar").setAttribute("aria-expanded", "false");
}
function makeMessageElement(role, text) {
  const message = document.createElement("article");
  message.className = `message ${role}`;
  const avatar = document.createElement("div");
  avatar.className = "message-avatar";
  avatar.setAttribute("aria-hidden", "true");
  avatar.textContent = role === "assistant" ? "✳" : "Y";
  const body = document.createElement("div");
  const meta = document.createElement("div");
  meta.className = "message-meta";
  meta.textContent = role === "assistant" ? "ORBIT" : "YOU";
  const content = document.createElement("div");
  content.className = "message-text";
  if (role === "assistant") {
    renderAssistantText(content, text);
  } else {
    content.textContent = text;
  }
  body.append(meta, content);
  message.dataset.rawText = text;
  if (role === "assistant") {
    const copyButton = document.createElement("button");
    copyButton.type = "button";
    copyButton.className = "copy-response-button";
    copyButton.textContent = "Copy response";
    copyButton.disabled = !text;
    copyButton.addEventListener("click", () => void copyText(message.dataset.rawText ?? "", copyButton));
    body.append(copyButton);
  }
  message.append(avatar, body);
  return message;
}

function renderConversation() {
  messagesElement.replaceChildren();
  welcome.hidden = messages.length > 0;
  for (const message of messages) {
    messagesElement.append(makeMessageElement(message.role, message.text));
  }
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function addMessage(role, text) {
  messages.push({ role, text });
  messagesElement.append(makeMessageElement(role, text));
  welcome.hidden = true;
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

async function copyText(text, button) {
  try {
    await navigator.clipboard.writeText(text);
    const originalLabel = button.textContent;
    button.textContent = "Copied";
    window.setTimeout(() => { button.textContent = originalLabel; }, 1400);
  } catch {
    errorElement.textContent = "Clipboard access was blocked by the browser.";
    errorElement.hidden = false;
  }
}

function runMessage(rawMessage) {
  const request = sendMessage(rawMessage);
  activeRequest = request;
  request.then(
    () => { if (activeRequest === request) activeRequest = null; },
    () => { if (activeRequest === request) activeRequest = null; },
  );
}

function showTyping() {
  const row = makeMessageElement("assistant", "");
  row.id = "typing-indicator";
  row.querySelector(".message-meta").textContent = "ORBIT IS THINKING";
  const dots = document.createElement("span");
  dots.className = "typing-dots";
  dots.setAttribute("aria-label", "Orbit is responding");
  for (let index = 0; index < 3; index += 1) dots.append(document.createElement("i"));
  row.querySelector(".message-text").replaceWith(dots);
  messagesElement.append(row);
  messagesElement.scrollTop = messagesElement.scrollHeight;
}

function selectMode(mode) {
  if (!["tutor", "practice", "homework"].includes(mode)) return;
  currentMode = mode;
  document.querySelectorAll(".mode-button").forEach((button) => {
    const selected = button.dataset.mode === currentMode;
    button.classList.toggle("is-active", selected);
    button.setAttribute("aria-pressed", String(selected));
  });
  saveConversation();
}

async function sendMessage(rawMessage) {
  const message = rawMessage.trim();
  if (!message || sendButton.disabled) return;
  errorElement.hidden = true;
  addMessage("user", message);
  saveConversation();
  input.value = "";
  input.style.height = "auto";
  activeController = new AbortController();
  let assistantMessage = null;
  let streamedText = "";
  sendButton.disabled = true;
  sendLabel.textContent = "Generating";
  stopButton.hidden = false;
  showTyping();

  try {
    const response = await fetch("/api/interactions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-3.8-flash",
        input: message,
        system_instruction: buildSystemInstruction(),
        generation_config: { thinking_level: chooseThinkingLevel(message) },
        stream: true,
        ...(previousInteractionId ? { previous_interaction_id: previousInteractionId } : {}),
      }),
      signal: activeController.signal,
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const cloudflareResponse = response.headers.has("cf-ray")
        || response.headers.get("server")?.toLowerCase().includes("cloudflare");
      let apiError = "";
      if (cloudflareResponse && [502, 503, 504].includes(response.status)) {
        apiError = `The Cloudflare tunnel could not reach the chatbot server (HTTP ${response.status}). Start the server with "py server.py", restart the tunnel with "cloudflared tunnel --url http://127.0.0.1:3001", use its latest URL, and keep both terminals open.`;
      } else if (response.headers.get("content-type")?.includes("text/html")) {
        apiError = `The server returned an HTML error page (HTTP ${response.status}) instead of a chat response. Check that the chatbot server and any tunnel are running.`;
      } else {
        try {
          const result = JSON.parse(errorBody);
          const apiErrorDetail = Array.isArray(result) ? result[0]?.error : result.error;
          apiError = typeof apiErrorDetail === "string" ? apiErrorDetail : apiErrorDetail?.message;
          if (apiErrorDetail?.details?.some((detail) => detail.reason === "API_KEY_INVALID")) {
            apiStatus = "invalid";
            renderKeyStatus();
          }
        } catch {
          apiError = errorBody.slice(0, 500);
        }
      }
      throw new Error(apiError || "Gemini could not reply. Check your key and model access.");
    }
    if (!response.headers.get("content-type")?.includes("text/event-stream")) {
      throw new Error("The server returned an unexpected response. Restart the chatbot server and try again.");
    }

    const result = await readInteractionStream(response, (text) => {
      streamedText = text;
      if (!assistantMessage) {
        document.querySelector("#typing-indicator")?.remove();
        assistantMessage = createStreamingAssistantMessage();
      }
      renderAssistantText(assistantMessage, text);
      messagesElement.scrollTop = messagesElement.scrollHeight;
    });
    if (!result.text.trim()) {
      throw new Error("Gemini completed without a text answer. Try again or rephrase your question.");
    }

    previousInteractionId = result.interactionId ?? previousInteractionId;
    assistantMessage.closest(".message")?.classList.remove("is-streaming");
    messages.push({ role: "assistant", text: result.text });
    saveConversation();
  } catch (error) {
    document.querySelector("#typing-indicator")?.remove();
    if (error.name === "AbortError") {
      const messageRow = assistantMessage?.closest(".message");
      messageRow?.classList.remove("is-streaming");
      if (streamedText.trim()) messages.push({ role: "assistant", text: streamedText });
      else messageRow?.remove();
      errorElement.hidden = true;
      saveConversation();
    } else {
      const messageRow = assistantMessage?.closest(".message");
      messageRow?.classList.remove("is-streaming");
      if (streamedText.trim()) messages.push({ role: "assistant", text: streamedText });
      errorElement.textContent = error.message || "Something went wrong. Please try again.";
      errorElement.hidden = false;
      saveConversation();
    }
    messagesElement.scrollTop = messagesElement.scrollHeight;
  } finally {
    activeController = null;
    stopButton.hidden = true;
    sendButton.disabled = false;
    sendLabel.textContent = "Ask Orbit";
    input.focus();
  }
}

function buildSystemInstruction() {
  const modeInstructions = {
    tutor: "Teach by building understanding, but answer direct questions fully. Break complex ideas into manageable steps and show the final answer with reasoning. Do not withhold a solution just to make the student guess. End with one useful next step or quick check only when it helps.",
    practice: "Act as a study partner. Ask one question at a time, wait for the student's answer, then give kind, specific feedback and a short explanation. Adapt difficulty to their responses.",
    homework: "Coach rather than completing graded work. Help the student identify the next step, explain relevant concepts, and give hints before solutions. If they show an attempt, respond to that work directly.",
  };

  return [
    "You are Orbit, an intelligent, patient study and general-purpose assistant. Help the learner understand, not just collect answers. Support exam preparation, education, technical questions, general knowledge, writing, reasoning, and problem solving.",
    `Learner level: ${profile.gradeLevel}.`,
    `Preferred explanation style: ${profile.explanationStyle}.`,
    profile.subjects ? `Subjects they are focusing on: ${profile.subjects}.` : "No preferred subjects have been set.",
    modeInstructions[currentMode],
    "Be accurate, meaningful, and context-aware. Use previous turns to understand follow-ups and avoid repeating what was already explained. Match length to the request: be brief when asked, otherwise give enough detail to make the answer useful. For complex explanations, organize with short headings, bullets or numbered steps, examples, and a brief takeaway when helpful. Explain technical terms in plain language. For code questions, provide working code and explain it line by line when requested; identify errors and show corrected code. For exam preparation, teach the underlying concept, show a worked example when useful, and point out common traps. When a student names an exam but leaves out important details, give useful general guidance first, then ask one focused question to personalize the next step. For GATE, ask which paper or branch they are preparing for before giving a paper-specific plan; don't assume it. If the request is unclear, ask a concise clarifying question. Admit uncertainty rather than inventing facts. Use age-appropriate language and be encouraging without being patronizing. Do not claim to be human.",
  ].join("\n");
}

function chooseThinkingLevel(message) {
  const complexQuestion = message.length > 240
    || /\b(explain|compare|analy[sz]e|derive|prove|debug|step[- ]by[- ]step|in detail|why|how does|solve|plan|code|prepare|exam)\b/i.test(message);
  return complexQuestion ? "medium" : "low";
}

function createStreamingAssistantMessage() {
  const message = makeMessageElement("assistant", "");
  message.classList.add("is-streaming");
  messagesElement.append(message);
  welcome.hidden = true;
  return message.querySelector(".message-text");
}

async function readInteractionStream(response, onText) {
  if (!response.body) throw new Error("Streaming is not available in this browser. Try reloading the page.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let interactionId = null;

  function readEvent(eventText) {
    const data = eventText.split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n");
    if (!data || data === "[DONE]") return;

    let event;
    try {
      event = JSON.parse(data);
    } catch {
      return;
    }

    if (event.event_type === "interaction.created" && event.interaction?.id) {
      interactionId = event.interaction.id;
    }
    if (event.event_type === "interaction.completed" && event.interaction?.id) {
      interactionId = event.interaction.id;
    }
    if (event.event_type === "step.delta" && event.delta?.type === "text" && typeof event.delta.text === "string") {
      text += event.delta.text;
      onText(text);
    }
    if (event.event_type === "interaction.failed") {
      if (event.error?.details?.some((detail) => detail.reason === "API_KEY_INVALID")) {
        apiStatus = "invalid";
        renderKeyStatus();
      }
      throw new Error(event.error?.message || "Gemini could not finish the response.");
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    buffer += decoder.decode(value, { stream: !done });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    events.forEach(readEvent);
    if (done) break;
  }

  if (buffer.trim()) readEvent(buffer);
  return { text, interactionId };
}

function appendInlineMarkdown(parent, text) {
  const tokenPattern = /(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g;
  let start = 0;

  for (const match of text.matchAll(tokenPattern)) {
    if (match.index > start) parent.append(document.createTextNode(text.slice(start, match.index)));
    const token = match[0];
    const element = token.startsWith("**")
      ? document.createElement("strong")
      : token.startsWith("*")
        ? document.createElement("em")
        : document.createElement("code");
    element.textContent = token.startsWith("**") ? token.slice(2, -2) : token.slice(1, -1);
    parent.append(element);
    start = match.index + token.length;
  }

  if (start < text.length) parent.append(document.createTextNode(text.slice(start)));
}

function renderAssistantText(container, text) {
  const message = container.closest(".message");
  if (message) {
    message.dataset.rawText = text;
    const copyButton = message.querySelector(".copy-response-button");
    if (copyButton) copyButton.disabled = !text;
  }
  const fragment = document.createDocumentFragment();
  const lines = text.split(/\r?\n/);
  let paragraph = [];
  let list = null;
  let codeLines = null;
  let codeLanguage = "";

  function flushParagraph() {
    if (!paragraph.length) return;
    const element = document.createElement("p");
    appendInlineMarkdown(element, paragraph.join(" "));
    fragment.append(element);
    paragraph = [];
  }

  function flushList() {
    if (!list) return;
    fragment.append(list);
    list = null;
  }

  function flushCode() {
    if (codeLines === null) return;
    const pre = document.createElement("pre");
    const code = document.createElement("code");
    code.textContent = codeLines.join("\n");
    const codeHeader = document.createElement("div");
    codeHeader.className = "code-block-header";
    const language = document.createElement("span");
    language.className = "code-language";
    language.textContent = codeLanguage || "CODE";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "code-copy-button";
    button.textContent = "Copy code";
    button.addEventListener("click", () => void copyText(code.textContent, button));
    codeHeader.append(language, button);
    pre.append(codeHeader, code);
    fragment.append(pre);
    codeLines = null;
    codeLanguage = "";
  }

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      flushParagraph();
      flushList();
      if (codeLines === null) {
        codeLines = [];
        codeLanguage = line.trimStart().slice(3).trim().toUpperCase();
      }
      else flushCode();
      continue;
    }
    if (codeLines !== null) {
      codeLines.push(line);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = line.match(/^\s{0,3}(#{1,3})\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const element = document.createElement(`h${heading[1].length + 1}`);
      appendInlineMarkdown(element, heading[2]);
      fragment.append(element);
      continue;
    }

    const item = line.match(/^\s*(?:[-*+]\s+|(\d+)\.\s+)(.+)$/);
    if (item) {
      flushParagraph();
      const listType = item[1] ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== listType) {
        flushList();
        list = document.createElement(listType);
      }
      const listItem = document.createElement("li");
      appendInlineMarkdown(listItem, item[2]);
      list.append(listItem);
      continue;
    }

    flushList();
    paragraph.push(line.trim());
  }

  flushParagraph();
  flushList();
  flushCode();
  container.replaceChildren(fragment);
}

function extractResponseText(interaction) {
  if (typeof interaction.output_text === "string") return interaction.output_text;
  if (Array.isArray(interaction.steps)) {
    const textParts = [];
    let collecting = false;

    for (let stepIndex = interaction.steps.length - 1; stepIndex >= 0; stepIndex -= 1) {
      const step = interaction.steps[stepIndex];
      if (step.type === "user_input") break;
      if (step.type === "thought") continue;
      if (step.type !== "model_output") {
        if (collecting) break;
        continue;
      }

      const content = Array.isArray(step.content) ? step.content : [];
      for (let contentIndex = content.length - 1; contentIndex >= 0; contentIndex -= 1) {
        const part = content[contentIndex];
        if (part.type === "text" && typeof part.text === "string") {
          collecting = true;
          textParts.push(part.text);
        } else if (collecting) {
          break;
        }
      }
    }

    if (textParts.length) return textParts.reverse().join("");
  }

  const outputs = interaction.outputs ?? interaction.output ?? [];
  if (!Array.isArray(outputs)) return "";
  return outputs.map((output) => {
    if (typeof output === "string") return output;
    if (typeof output?.text === "string") return output.text;
    if (Array.isArray(output?.content)) {
      return output.content.map((part) => typeof part?.text === "string" ? part.text : "").join("");
    }
    return "";
  }).filter(Boolean).join("\n\n");
}

function openProfileDialog() {
  profileForm.elements.gradeLevel.value = profile.gradeLevel;
  profileForm.elements.subjects.value = profile.subjects;
  profileForm.elements.explanationStyle.value = profile.explanationStyle;
  profileDialog.showModal();
}

form.addEventListener("submit", (event) => {
  event.preventDefault();
  runMessage(input.value);
});

input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 150)}px`;
});

input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    form.requestSubmit();
  }
});

document.querySelectorAll(".mode-button").forEach((button) => {
  button.addEventListener("click", () => selectMode(button.dataset.mode));
});

document.querySelectorAll(".suggestion").forEach((button) => {
  button.addEventListener("click", () => {
    if (button.dataset.mode) selectMode(button.dataset.mode);
    runMessage(button.dataset.prompt ?? "");
  });
});

document.querySelector("#new-chat").addEventListener("click", () => void startNewChat());
document.querySelector("#reset-chat").addEventListener("click", () => void startNewChat());
stopButton.addEventListener("click", () => activeController?.abort());
document.querySelector("#toggle-sidebar").addEventListener("click", () => {
  const open = !document.body.classList.contains("sidebar-open");
  document.body.classList.toggle("sidebar-open", open);
  document.querySelector("#toggle-sidebar").setAttribute("aria-expanded", String(open));
});
document.querySelector("#sidebar-backdrop").addEventListener("click", () => {
  document.body.classList.remove("sidebar-open");
  document.querySelector("#toggle-sidebar").setAttribute("aria-expanded", "false");
});
document.querySelector("#edit-profile").addEventListener("click", openProfileDialog);
document.querySelector("#close-profile").addEventListener("click", () => profileDialog.close());
document.querySelector("#cancel-profile").addEventListener("click", () => profileDialog.close());
profileForm.addEventListener("submit", (event) => {
  event.preventDefault();
  profile = {
    gradeLevel: profileForm.elements.gradeLevel.value,
    subjects: profileForm.elements.subjects.value.trim().slice(0, 120),
    explanationStyle: profileForm.elements.explanationStyle.value,
  };
  localStorage.setItem(profileStorageKey, JSON.stringify(profile));
  updateProfileSummary();
  profileDialog.close();
});

profileDialog.addEventListener("click", (event) => {
  if (event.target === profileDialog) profileDialog.close();
});

document.querySelector("#theme-toggle").addEventListener("click", () => {
  const nextTheme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(themeStorageKey, nextTheme);
  updateThemeButton();
});

function updateThemeButton() {
  const button = document.querySelector("#theme-toggle");
  const darkMode = document.documentElement.dataset.theme === "dark";
  button.setAttribute("aria-label", darkMode ? "Switch to light mode" : "Switch to dark mode");
  button.title = darkMode ? "Switch to light mode" : "Switch to dark mode";
  button.innerHTML = `<span aria-hidden="true">${darkMode ? "☼" : "◐"}</span>`;
}

function renderKeyStatus() {
  const dot = document.querySelector("#connection-dot");
  const title = document.querySelector("#connection-title");
  const detail = document.querySelector("#connection-detail");
  dot.classList.toggle("is-ready", apiStatus === "ready");
  dot.classList.toggle("is-missing", apiStatus === "missing" || apiStatus === "invalid");
  title.textContent = {
    checking: "Checking Gemini",
    ready: "API key configured",
    invalid: "Invalid API key",
    missing: "API key needed",
    unavailable: "Server unavailable",
  }[apiStatus];
  detail.textContent = {
    checking: "Checking server configuration",
    ready: "Key stored on server; validity checked on use",
    invalid: "Replace GEMINI_API_KEY in .env and restart",
    missing: "Set GEMINI_API_KEY in .env",
    unavailable: "Restart the local server and try again",
  }[apiStatus];
}

async function checkApiStatus() {
  try {
    const response = await fetch("/api/status");
    if (!response.ok) throw new Error(`Server returned ${response.status}`);
    const status = await response.json();
    apiStatus = status.apiKeyConfigured === true ? "ready" : "missing";
  } catch (error) {
    apiStatus = "unavailable";
    console.error("Could not check Gemini configuration:", error);
  }
  renderKeyStatus();
}

updateProfileSummary();
selectMode(currentMode);
renderConversation();
renderChatHistory();
updateThemeButton();
void checkApiStatus();