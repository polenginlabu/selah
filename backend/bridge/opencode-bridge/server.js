/**
 * OpenCode Bridge Server
 *
 * This Express server acts as a bridge between the browser chat UI (build.html)
 * and the OpenCode server API. It handles:
 * - Multiple session creation, switching, and deletion
 * - Model selection per message
 * - Message forwarding to OpenCode
 * - Response extraction
 * - CORS for cross-origin requests
 *
 * Architecture:
 *   Browser (build.html) --HTTP--> This Server (port 4098) --HTTP--> OpenCode Server (port 4097)
 */

const express = require("express");
const cors = require("cors");
const fs = require("node:fs");

// ─── Configuration ───────────────────────────────────────────────────────────

// OpenCode server base URL (adjust if your server runs on a different host/port)
const OPENCODE_BASE_URL =
  process.env.OPENCODE_URL || "http://127.0.0.1:4097";

// Port for this bridge server (must differ from OpenCode's port)
const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || "4098", 10);

// Bind address. Defaults to loopback: this bridge has NO authentication and
// runs an agent with filesystem access, so binding it to 0.0.0.0 on a public
// server hands anyone who finds the port the ability to read and write files
// as this user. Everything that needs it (the devotion cron, a UI served from
// the same box via a reverse proxy) reaches it over loopback.
//
// Set BRIDGE_HOST=0.0.0.0 only behind a firewall or a VPN, never on a VPS with
// a public IP and no filtering.
const BRIDGE_HOST = process.env.BRIDGE_HOST || "127.0.0.1";

// Shared secret for requests that arrive from outside this machine.
//
// The bridge runs an agent with filesystem access and has no user accounts, so
// until now the ONLY thing protecting it was that it listens on loopback. The
// moment anything off-box needs to reach it — the SELAH admin console checking
// whether the agent is up — that protection is gone, and the port becomes a
// remote shell for whoever finds it.
//
// So: when BRIDGE_TOKEN is set, every /api route requires it. Leave it unset
// for purely local use (the devotion generator on a laptop, the GitHub Action,
// which both reach the bridge over loopback and would only be inconvenienced
// by a secret). Set it anywhere the bridge is reachable from the internet.
const BRIDGE_TOKEN = process.env.BRIDGE_TOKEN || "";

// Password for OpenCode itself, which is a SEPARATE problem from BRIDGE_TOKEN.
//
// BRIDGE_TOKEN guards the front door. This guards the back one: OpenCode
// listens on 127.0.0.1:4097 and, unprotected, will drive an agent with
// filesystem access for anyone who can open that socket. On a VPS that is only
// this machine's users; on SHARED hosting, tenants commonly share the host's
// network namespace, so "localhost" is not private to your account and a
// neighbour could bypass the bridge entirely and read ~/.local/share/opencode/
// auth.json — which holds live provider API keys.
//
// OpenCode expects HTTP Basic (any username, this value as the password), so
// every call out of this bridge carries it when the variable is set. Leave it
// unset for a laptop, where loopback really is private.
const OPENCODE_PASSWORD = process.env.OPENCODE_SERVER_PASSWORD || "";

function opencodeAuthHeader() {
  if (!OPENCODE_PASSWORD) return {};
  const encoded = Buffer.from(`opencode:${OPENCODE_PASSWORD}`).toString("base64");
  return { Authorization: `Basic ${encoded}` };
}

// ─── In-memory session & model store ─────────────────────────────────────────
// Stores multiple sessions so the user can switch between chats.
// Each session tracks its OpenCode session ID and local metadata.
const sessions = new Map(); // localId -> { id, title, opencodeId, messages: [] }
let activeSessionId = null;

// Async chat jobs for polling mode
const chatJobs = new Map(); // jobId -> { id, phase, message, done, response, ... }

// Currently selected model (e.g. "qwen3-coder-next")
let activeModel = null;

// Preferred workspace root passed through the bridge UI.
// A root path that does not exist is the single most confusing failure this
// bridge has: OpenCode accepts the session, the prompt never progresses, and
// 120 seconds later the job dies as "OpenCode stalled without progress" with
// nothing pointing at the cause. The VPS default (/var/www/html) does not
// exist on a dev machine, so resolve to something real at startup instead.
function resolveRootPath() {
  const candidates = [
    process.env.OPENCODE_ROOT_PATH,
    "/var/www/html",
    process.cwd(),
  ];
  for (const candidate of candidates) {
    if (candidate && isUsableDirectory(candidate)) return candidate;
  }
  return process.cwd();
}

function isUsableDirectory(candidate) {
  try {
    return fs.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

let activeRootPath = resolveRootPath();

// ─── Express app setup ───────────────────────────────────────────────────────

const app = express();

// Parse JSON request bodies (max 1 MB)
app.use(express.json({ limit: "1mb" }));

// CORS: allow requests from any origin since build.html may be served
// by nginx/apache on a different port or domain.
app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST", "DELETE", "PATCH", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Constant-time compare, so a caller cannot learn the token one character at a
// time from how long the rejection takes.
function tokenMatches(presented) {
  const expected = BRIDGE_TOKEN;
  if (presented.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= presented.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * Did this request come through a reverse proxy — i.e. from off this machine?
 *
 * The socket address is useless for this: a proxy on the same box connects
 * over loopback, so every forwarded request looks local. The forwarding
 * headers are what actually distinguish them.
 */
function arrivedViaProxy(req) {
  return Boolean(
    req.get("x-forwarded-for") ||
    req.get("x-forwarded-host") ||
    req.get("x-forwarded-proto") ||
    req.get("x-real-ip")
  );
}

app.use("/api", (req, res, next) => {
  // Preflight carries no Authorization header by design.
  if (req.method === "OPTIONS") return next();

  // FAIL SAFE. Publishing a path to this bridge is a deliberate act (an
  // .htaccess proxy rule), but setting BRIDGE_TOKEN is a separate one, and
  // doing the first without the second would hand the internet an agent with
  // filesystem access. So a request that arrived through a proxy is refused
  // outright when no token is configured, rather than being served because
  // the bridge happens to be in its permissive local mode.
  if (!BRIDGE_TOKEN) {
    if (arrivedViaProxy(req)) {
      console.warn("[auth] refused a proxied request: BRIDGE_TOKEN is not set");
      return res.status(401).json({
        error: "This bridge is reachable from outside but has no BRIDGE_TOKEN set. Refusing.",
      });
    }
    return next();
  }

  const header = req.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!presented || !tokenMatches(presented)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  return next();
});

// ─── Helper: call OpenCode server API ────────────────────────────────────────

/**
 * Makes an HTTP request to the OpenCode server.
 * @param {string} path - API path (e.g. "/session")
 * @param {object} options - fetch options (method, headers, body)
 * @returns {Promise<object>} Parsed JSON response
 */
async function opencodeFetch(path, options = {}) {
  const urlObject = new URL(`${OPENCODE_BASE_URL}${path}`);
  if (options.directory) {
    urlObject.searchParams.set("directory", options.directory);
  }
  if (options.workspace) {
    urlObject.searchParams.set("workspace", options.workspace);
  }

  const url = urlObject.toString();
  const res = await fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...opencodeAuthHeader(),
      ...(options.headers || {}),
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `OpenCode API error ${res.status}: ${text || res.statusText}`
    );
  }

  const text = await res.text();
  if (!text) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`OpenCode API returned non-JSON response for ${path}`);
  }
}

// ─── Helper: extract text from OpenCode message response parts ───────────────

/**
 * The OpenCode message response contains multiple "parts" of different types.
 * We extract only the "text" parts to get the assistant's reply.
 *
 * @param {Array} parts - Array of part objects from OpenCode response
 * @returns {string} Concatenated text content
 */
function extractTextFromParts(parts) {
  if (!Array.isArray(parts)) return "";
  return parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
}

/**
 * Extracts generated IMAGE parts from an OpenCode message.
 *
 * Added for the SELAH daily background job, which prompts an image model
 * (Nano Banana / google/gemini-3.1-flash-image) rather than a text one, so the
 * thing worth keeping is bytes rather than prose. extractTextFromParts above
 * drops everything that is not `type: "text"`, which for an image run is the
 * entire answer.
 *
 * The part shape is read defensively. OpenCode normalises providers behind its
 * own part schema, but an image reply can arrive as an inline data: URL, as a
 * URL to fetch, or as a file OpenCode has already written to disk, and which
 * one you get depends on the provider and the version. Rather than guess, this
 * records every plausible carrier and lets the caller resolve it; anything
 * unrecognised is reported by type in `unknown` so a surprise is diagnosable
 * from the job result instead of silently becoming "no image".
 *
 * @param {Array} parts
 * @returns {{images: Array<object>, unknown: string[]}}
 */
function extractImagesFromParts(parts) {
  const images = [];
  const unknown = [];
  if (!Array.isArray(parts)) return { images, unknown };

  for (const part of parts) {
    const type = part?.type;
    if (!type || type === "text" || type === "reasoning" || type === "step-start" ||
        type === "step-finish" || type === "tool" || type === "patch" ||
        type === "snapshot" || type === "agent") {
      continue;
    }

    const mime = part.mime || part.mediaType || part.contentType || "";
    const url = part.url || part.source?.url || "";
    const path = part.path || part.filename || part.source?.path || part.source?.text?.value || "";
    // Some shapes carry raw base64 directly rather than as a data: URL.
    const data = typeof part.data === "string" ? part.data
      : typeof part.image === "string" ? part.image
      : typeof part.base64 === "string" ? part.base64
      : "";

    const looksLikeImage =
      mime.startsWith("image/") ||
      url.startsWith("data:image/") ||
      /\.(png|jpe?g|webp|gif)$/i.test(url || path);

    if ((type === "file" || type === "image") && (url || path || data)) {
      if (looksLikeImage || !mime) {
        images.push({ mime: mime || null, url: url || null, path: path || null, data: data || null });
        continue;
      }
    }
    unknown.push(type);
  }

  return { images, unknown };
}

/**
 * Resolve a model string to OpenCode model object format.
 * Accepts plain model IDs (eg: "qwen3-coder-next") or "provider/model".
 * Returns null if model is not found.
 */
async function resolveModelObject(modelValue) {
  if (!modelValue || typeof modelValue !== "string") return null;

  // provider/model shortcut
  if (modelValue.includes("/") && !modelValue.startsWith("http")) {
    const [providerID, ...rest] = modelValue.split("/");
    const modelID = rest.join("/");
    if (providerID && modelID) {
      return { providerID, modelID };
    }
  }

  // Find provider by model ID from /provider
  const providerData = await opencodeFetch("/provider");
  for (const provider of providerData.all || []) {
    if (provider.models && provider.models[modelValue]) {
      return {
        providerID: provider.id,
        modelID: modelValue,
      };
    }
  }

  return null;
}

function buildMessagePayload(message, modelObject) {
  const promptText = activeRootPath
    ? [
        `Workspace root: ${activeRootPath}`,
        "Only read and edit files inside this root unless the user explicitly asks otherwise.",
        "",
        message.trim(),
      ].join("\n")
    : message.trim();

  const payload = {
    parts: [
      {
        type: "text",
        text: promptText,
      },
    ],
  };

  if (modelObject) {
    payload.model = modelObject;
  }

  return payload;
}

function getTextFromMessageItem(item) {
  if (!item || !item.parts) return "";
  return extractTextFromParts(item.parts);
}

// ─── Helper: generate a short unique ID ──────────────────────────────────────

function generateId() {
  return "sess_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function generateJobId() {
  return "job_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function createChatJob(message, model) {
  const id = generateJobId();
  const now = Date.now();
  const job = {
    id,
    input: message,
    model: model || activeModel || "default",
    phase: "queued",
    message: "Queued",
    done: false,
    response: "",
    error: null,
    tools: [],
    failedTools: [],
    // Generated image parts, for image-model runs (the SELAH daily background).
    // Empty for every ordinary text run.
    images: [],
    unknownParts: [],
    sessionId: null,
    createdAt: now,
    updatedAt: now,
  };
  chatJobs.set(id, job);
  return job;
}

function updateJob(job, patch) {
  Object.assign(job, patch, { updatedAt: Date.now() });
}

function completeJob(job, responseText, model, sessionId, images) {
  updateJob(job, {
    done: true,
    phase: "done",
    message: "Completed",
    response: responseText || "",
    images: images || job.images || [],
    model: model || job.model,
    sessionId: sessionId || job.sessionId,
  });
}

function failJob(job, errorMessage) {
  updateJob(job, {
    done: true,
    phase: "error",
    message: "Failed",
    error: errorMessage || "Unknown error",
  });
}

function findLatestUserMessage(messages, text, startedAt) {
  const normalizedText = text.trim();
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item?.info?.role !== "user") continue;
    const createdAt = item.info?.time?.created || 0;
    if (createdAt < startedAt) continue;
    if (getTextFromMessageItem(item).trim() === normalizedText) {
      return item;
    }
  }
  return null;
}

function findAssistantReply(messages, userMessageId) {
  if (!userMessageId) return null;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i];
    if (item?.info?.role !== "assistant") continue;
    if (item.info?.parentID === userMessageId) {
      return item;
    }
  }
  return null;
}

function getMessageError(messageItem) {
  const error = messageItem?.info?.error;
  if (!error) return "";
  // OpenCode reports provider failures (auth, billing, rate limits) on the
  // assistant message rather than the HTTP response, so a job that never
  // checks this completes "successfully" with empty text. That turned a
  // plain "monthly spending limit reached" into a silent empty reply.
  const message =
    error?.data?.message || error?.message || error?.name || "Unknown provider error";
  return String(message);
}

/**
 * Any provider error in the recent messages, whoever they belong to.
 *
 * getMessageError() only inspects the assistant message parented to OUR user
 * message. When the provider rejects the request before that message exists —
 * a quota refusal, a bad key — there is nothing to inspect, the poll loop sees
 * no progress, and the job dies 120 seconds later as "stalled without
 * progress". The real reason was sitting in the message list the whole time.
 *
 * Used only to enrich a failure, never to fail a healthy job.
 */
function findAnyRecentError(messages) {
  if (!Array.isArray(messages)) return "";
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const error = getMessageError(messages[i]);
    if (error) return error;
  }
  return "";
}

function getRunningToolName(messageItem) {
  const parts = messageItem?.parts || [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part?.type === "tool" && part.state?.status === "running") {
      return part.tool || part.toolName || "tool";
    }
  }
  return "";
}

function getFailedToolName(messageItem) {
  const parts = messageItem?.parts || [];
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const part = parts[i];
    if (part?.type === "tool" && part.state?.status === "error") {
      return part.tool || part.toolName || "tool";
    }
  }
  return "";
}

function getCompletedToolNames(messageItem) {
  const names = [];
  const parts = messageItem?.parts || [];
  for (const part of parts) {
    if (part?.type !== "tool" || part.state?.status !== "completed") continue;
    const name = part.tool || part.toolName || "tool";
    if (!names.includes(name)) {
      names.push(name);
    }
  }
  return names;
}

async function executeChatJob(job, message, model) {
  updateJob(job, { phase: "thinking", message: "OpenCode is thinking..." });

  const opencodeSessionId = await ensureSession();
  const localSessionId = activeSessionId;
  const localSession = sessions.get(localSessionId);
  if (!localSession) {
    throw new Error("Active session missing");
  }

  updateJob(job, {
    sessionId: localSessionId,
    opencodeSessionId,
    phase: "thinking",
    message: "Preparing request...",
  });

  const modelToUse = model || activeModel;
  const modelObject = await resolveModelObject(modelToUse);
  const payload = buildMessagePayload(message, modelObject);
  const promptText = payload.parts?.[0]?.text || message.trim();
  const startedAt = Date.now();
  updateJob(job, {
    phase: "working",
    message: "Sending request to OpenCode...",
  });

  await opencodeFetch(`/session/${opencodeSessionId}/prompt_async`, {
    method: "POST",
    body: JSON.stringify(payload),
    directory: activeRootPath,
  });

  let responseText = "";
  let trackedUserMessageId = null;
  let lastProgressAt = Date.now();
  let lastSignature = "";
  const deadline = Date.now() + 10 * 60 * 1000;

  while (Date.now() < deadline) {
    const latestMessages = await opencodeFetch(
      `/session/${opencodeSessionId}/message?limit=30`,
      { directory: activeRootPath }
    );

    if (!trackedUserMessageId) {
      const userMessage = findLatestUserMessage(latestMessages, promptText, startedAt);
      trackedUserMessageId = userMessage?.info?.id || null;
    }

    const assistantMessage = findAssistantReply(latestMessages, trackedUserMessageId);
    const runningTool = getRunningToolName(assistantMessage);
    const failedTool = getFailedToolName(assistantMessage);
    const completedTools = getCompletedToolNames(assistantMessage);
    const nextResponseText = getTextFromMessageItem(assistantMessage);
    const { images: nextImages, unknown: unknownPartTypes } =
      extractImagesFromParts(assistantMessage?.parts);
    const finish = assistantMessage?.info?.finish || "";
    const completedAt = assistantMessage?.info?.time?.completed || 0;
    const signature = [
      trackedUserMessageId || "",
      assistantMessage?.info?.id || "",
      runningTool,
      failedTool,
      finish,
      completedAt,
      nextResponseText.length,
      // An image model can answer with bytes and no prose at all. Without this
      // the signature never changes, the run looks stalled, and the stall
      // guard below kills a job that actually succeeded.
      nextImages.length,
      (assistantMessage?.parts || []).length,
    ].join("|");

    if (signature !== lastSignature) {
      lastSignature = signature;
      lastProgressAt = Date.now();
    }

    const messageError = getMessageError(assistantMessage);
    if (messageError) {
      throw new Error(`OpenCode provider error: ${messageError}`);
    }

    // A failed tool is NOT a failed job. A research run fetches several
    // sources and it is routine for one to 404, time out, or block the
    // fetcher; the agent simply tries another. Aborting here threw away
    // multi-minute runs over a single dead link. Record it and let the agent
    // decide — a genuine dead end still surfaces via the stall timeouts below
    // or an empty final response.
    if (failedTool && !job.failedTools.includes(failedTool)) {
      job.failedTools.push(failedTool);
      console.log(`[chat-job] tool failed (continuing): ${failedTool}`);
    }

    if (nextImages.length !== job.images.length) {
      job.images = nextImages;
      job.unknownParts = unknownPartTypes;
      updateJob(job, {
        phase: "responding",
        message: `OpenCode returned ${nextImages.length} image part(s)`,
      });
    }

    if (nextResponseText && nextResponseText !== responseText) {
      responseText = nextResponseText;
      updateJob(job, {
        phase: "responding",
        message: "OpenCode is writing...",
        response: responseText,
      });
    } else if (runningTool) {
      if (!job.tools.includes(runningTool)) {
        job.tools.push(runningTool);
      }
      updateJob(job, {
        phase: "working",
        message: `Running tool: ${runningTool}`,
      });
    } else if (completedTools.length > 0) {
      for (const toolName of completedTools) {
        if (!job.tools.includes(toolName)) {
          job.tools.push(toolName);
        }
      }
      updateJob(job, {
        phase: "responding",
        message: `Finishing after tools: ${completedTools.join(", ")}`,
      });
    } else if (assistantMessage) {
      updateJob(job, {
        phase: "thinking",
        message: "OpenCode is thinking...",
      });
    } else {
      const elapsedSeconds = Math.floor((Date.now() - startedAt) / 1000);
      updateJob(job, {
        phase: "working",
        message: `OpenCode is still working... ${elapsedSeconds}s`,
      });
    }

    if (assistantMessage && (finish && finish !== "tool-calls" || completedAt)) {
      break;
    }

    const stalledForMs = Date.now() - lastProgressAt;
    if (runningTool && stalledForMs > 60000) {
      throw new Error(`OpenCode stalled while running tool: ${runningTool}`);
    }
    if (!runningTool && stalledForMs > 120000) {
      // Say WHY where we can. A provider that refused the request leaves its
      // reason on a message we were not looking at; reporting "stalled" alone
      // sends people hunting for a hang that never happened.
      const hidden = findAnyRecentError(latestMessages);
      if (hidden) {
        throw new Error(`OpenCode provider error: ${hidden}`);
      }
      throw new Error(
        "OpenCode stalled without progress" +
          (trackedUserMessageId
            ? " (the prompt was accepted but the model never replied)"
            : " (OpenCode never registered the prompt — check the model id and that the provider is authenticated)")
      );
    }

    if (!runningTool && completedTools.length > 0 && stalledForMs > 15000) {
      responseText = `Changes were applied under ${activeRootPath}, but OpenCode did not send a final summary. Completed tools: ${completedTools.join(", ")}.`;
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  if (!responseText && job.images.length === 0 && Date.now() >= deadline) {
    throw new Error("OpenCode request timed out after 10 minutes");
  }

  localSession.messages.push(
    { role: "user", content: message.trim() },
    { role: "ai", content: responseText }
  );

  completeJob(job, responseText, modelToUse || "default", localSessionId, job.images);
}

// ─── Helper: ensure an active session exists ─────────────────────────────────

/**
 * Ensures an active local session exists and links it to an OpenCode session.
 * If no session exists, creates one. If session lacks an OpenCode ID, creates one.
 *
 * @returns {Promise<string>} The OpenCode session ID
 */
async function ensureSession() {
  // If no active session or the active session doesn't exist, create one
  if (!activeSessionId || !sessions.has(activeSessionId)) {
    const id = generateId();
    const session = {
      id,
      title: "New Chat",
      opencodeId: null,
      messages: [],
      createdAt: Date.now(),
    };
    sessions.set(id, session);
    activeSessionId = id;
  }

  const session = sessions.get(activeSessionId);

  // If this local session already has an OpenCode session ID, verify it still exists
  if (session.opencodeId) {
    try {
      await opencodeFetch(`/session/${session.opencodeId}`, {
        directory: activeRootPath,
      });
      return session.opencodeId;
    } catch {
      // Session was deleted on OpenCode side; create a fresh one
      session.opencodeId = null;
    }
  }

  // Create a new OpenCode session for this local session
  return createOpenCodeSession(session.title || "New Chat");
}

/**
 * Creates a new OpenCode session and links it to the active local session.
 *
 * @param {string} title
 * @returns {Promise<string>} The OpenCode session ID
 */
async function createOpenCodeSession(title) {
  const session = await opencodeFetch("/session", {
    method: "POST",
    body: JSON.stringify({ title }),
    directory: activeRootPath,
  });

  if (activeSessionId && sessions.has(activeSessionId)) {
    sessions.get(activeSessionId).opencodeId = session.id;
  }

  console.log(`[session] Created OpenCode session: ${session.id}`);
  return session.id;
}

// ─── Helper: load messages from OpenCode for a session ───────────────────────

/**
 * Fetches existing messages from an OpenCode session so the UI
 * can display the full conversation history when switching sessions.
 *
 * @param {string} opencodeSessionId
 * @returns {Promise<Array>} Array of {role, content} objects
 */
async function fetchSessionMessages(opencodeSessionId) {
  const result = await opencodeFetch(
    `/session/${opencodeSessionId}/message?limit=200`,
    { directory: activeRootPath }
  );

  if (!Array.isArray(result)) return [];

  return result
    .map((item) => {
      const role = item.info?.role;
      if (!role) return null;

      const textParts = (item.parts || [])
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text)
        .join("\n\n");

      if (!textParts) return null;

      return {
        role: role === "user" ? "user" : "ai",
        content: textParts,
      };
    })
    .filter(Boolean);
}

// ─── Routes ──────────────────────────────────────────────────────────────────

/**
 * GET /api/health
 * Checks if the OpenCode server is reachable.
 */
app.get("/api/health", async (_req, res) => {
  try {
    const health = await opencodeFetch("/global/health");
    res.json({
      success: health.healthy === true,
      opencode: health,
      sessionId: activeSessionId,
      model: activeModel,
      rootPath: activeRootPath,
      bridge: "ok",
    });
  } catch (err) {
    res.status(503).json({
      success: false,
      error: "OpenCode server unreachable",
      details: err.message,
    });
  }
});

/**
 * GET /api/models
 * Fetches all available models from OpenCode providers.
 */
app.get("/api/models", async (_req, res) => {
  try {
    const data = await opencodeFetch("/provider");
    // Build a flat list of models from all providers
    const models = [];
    for (const provider of data.all || []) {
      for (const [modelId, modelInfo] of Object.entries(provider.models || {})) {
        models.push({
          id: modelId,
          name: modelInfo.name || modelId,
          provider: provider.name || provider.id,
          providerId: provider.id,
        });
      }
    }
    res.json({
      models,
      activeModel: activeModel,
    });
  } catch (err) {
    res.status(502).json({
      error: "Failed to fetch models",
      details: err.message,
    });
  }
});

/**
 * POST /api/model
 * Sets the active model for future messages.
 * Body: { model: string }
 */
app.post("/api/model", (req, res) => {
  const { model } = req.body;
  if (!model || typeof model !== "string") {
    return res.status(400).json({ error: "Model is required" });
  }
  activeModel = model;
  console.log(`[model] Switched to: ${model}`);
  res.json({ success: true, model: activeModel });
});

/**
 * GET /api/root-path
 * Returns the configured workspace root path used for prompts.
 */
app.get("/api/root-path", (_req, res) => {
  res.json({ success: true, rootPath: activeRootPath });
});

/**
 * POST /api/root-path
 * Sets the preferred workspace root path used for prompts.
 * Body: { rootPath: string }
 */
app.post("/api/root-path", (req, res) => {
  const { rootPath } = req.body;
  if (!rootPath || typeof rootPath !== "string") {
    return res.status(400).json({ error: "Root path is required" });
  }

  const next = rootPath.trim();
  // Reject up front rather than let every later job stall for two minutes.
  if (!isUsableDirectory(next)) {
    return res.status(400).json({
      error: `Root path is not an existing directory: ${next}`,
    });
  }

  activeRootPath = next;
  console.log(`[root-path] Set to: ${activeRootPath}`);
  res.json({ success: true, rootPath: activeRootPath });
});

/**
 * GET /api/sessions
 * Returns all local sessions with their metadata.
 */
app.get("/api/sessions", (_req, res) => {
  const list = [];
  for (const [id, s] of sessions.entries()) {
    list.push({
      id: s.id,
      title: s.title,
      messageCount: s.messages.length,
      isActive: id === activeSessionId,
      createdAt: s.createdAt,
    });
  }
  // Sort newest first
  list.sort((a, b) => b.createdAt - a.createdAt);
  res.json({ sessions: list, activeSessionId });
});

/**
 * POST /api/sessions
 * Creates a new chat session.
 * Body: { title?: string }
 */
app.post("/api/sessions", (req, res) => {
  const id = generateId();
  const title = (req.body.title || "New Chat").trim() || "New Chat";
  const session = {
    id,
    title,
    opencodeId: null, // will be created on first message
    messages: [],
    createdAt: Date.now(),
  };
  sessions.set(id, session);
  activeSessionId = id;
  console.log(`[sessions] Created: ${id} ("${title}")`);
  res.json({ id, title, messageCount: 0 });
});

/**
 * POST /api/sessions/:id/activate
 * Switches the active session.
 */
app.post("/api/sessions/:id/activate", async (req, res) => {
  const { id } = req.params;
  if (!sessions.has(id)) {
    return res.status(404).json({ error: "Session not found" });
  }
  activeSessionId = id;
  const session = sessions.get(id);

  // Fetch existing messages from OpenCode if this session has one
  let messages = session.messages;
  if (session.opencodeId) {
    try {
      messages = await fetchSessionMessages(session.opencodeId);
      session.messages = messages;
    } catch (err) {
      console.error(`[sessions] Error fetching messages: ${err.message}`);
    }
  }

  console.log(`[sessions] Activated: ${id}`);
  res.json({
    id: session.id,
    title: session.title,
    messages,
    opencodeId: session.opencodeId,
  });
});

/**
 * DELETE /api/sessions/:id
 * Deletes a session (both locally and on OpenCode).
 */
app.delete("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  if (!sessions.has(id)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const session = sessions.get(id);

  // Delete on OpenCode side if it exists
  if (session.opencodeId) {
    try {
      await opencodeFetch(`/session/${session.opencodeId}`, {
        method: "DELETE",
      });
    } catch (err) {
      console.error(`[sessions] Error deleting OpenCode session: ${err.message}`);
    }
  }

  sessions.delete(id);

  // If we deleted the active session, pick another or create one
  if (activeSessionId === id) {
    activeSessionId = null;
    if (sessions.size === 0) {
      // Auto-create a new session so there's always one
      const newId = generateId();
      sessions.set(newId, {
        id: newId,
        title: "New Chat",
        opencodeId: null,
        messages: [],
        createdAt: Date.now(),
      });
      activeSessionId = newId;
    } else {
      activeSessionId = sessions.keys().next().value;
    }
  }

  console.log(`[sessions] Deleted: ${id}`);
  res.json({ success: true });
});

/**
 * PATCH /api/sessions/:id
 * Updates a session's title.
 * Body: { title: string }
 */
app.patch("/api/sessions/:id", async (req, res) => {
  const { id } = req.params;
  if (!sessions.has(id)) {
    return res.status(404).json({ error: "Session not found" });
  }

  const { title } = req.body;
  if (!title || typeof title !== "string") {
    return res.status(400).json({ error: "Title is required" });
  }

  const session = sessions.get(id);
  session.title = title.trim();

  // Also update on OpenCode if it exists
  if (session.opencodeId) {
    try {
      await opencodeFetch(`/session/${session.opencodeId}`, {
        method: "PATCH",
        body: JSON.stringify({ title: session.title }),
      });
    } catch (err) {
      console.error(`[sessions] Error updating title: ${err.message}`);
    }
  }

  res.json({ success: true, title: session.title });
});

/**
 * POST /api/chat/start
 * Starts an async chat job for polling mode.
 *
 * Body: { message: string, model?: string }
 * Response: { jobId, phase, message }
 */
app.post("/api/chat/start", async (req, res) => {
  const { message, model } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      error: "Message is required and must be a non-empty string",
    });
  }

  const job = createChatJob(message.trim(), model);

  executeChatJob(job, message.trim(), model).catch((err) => {
    console.error("[chat-job] Error:", err.message);
    failJob(job, err.message);
  });

  res.json({
    success: true,
    jobId: job.id,
    phase: job.phase,
    message: job.message,
    sessionId: job.sessionId,
  });
});

/**
 * GET /api/chat/status/:jobId
 * Returns current state for a polling chat job.
 */
app.get("/api/chat/status/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = chatJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  res.json({
    success: true,
    jobId: job.id,
    done: job.done,
    phase: job.phase,
    message: job.message,
    response: job.response,
    error: job.error,
    model: job.model,
    sessionId: job.sessionId,
    tools: job.tools,
    failedTools: job.failedTools,
    images: job.images,
    unknownParts: job.unknownParts,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
});

/**
 * GET /api/chat/result/:jobId
 * Returns final result of a polling job.
 */
app.get("/api/chat/result/:jobId", (req, res) => {
  const { jobId } = req.params;
  const job = chatJobs.get(jobId);
  if (!job) {
    return res.status(404).json({ error: "Job not found" });
  }

  if (!job.done) {
    return res.status(202).json({
      success: false,
      done: false,
      phase: job.phase,
      message: job.message,
    });
  }

  if (job.error) {
    return res.status(502).json({
      success: false,
      done: true,
      error: "Failed to get response from OpenCode",
      details: job.error,
      phase: job.phase,
      message: job.message,
    });
  }

  res.json({
    success: true,
    done: true,
    response: job.response,
    images: job.images,
    unknownParts: job.unknownParts,
    model: job.model,
    sessionId: job.sessionId,
  });
});

/**
 * POST /api/chat/stream
 * Streams OpenCode activity in real time via SSE.
 *
 * Body: { message: string, model?: string }
 * Events:
 * - session
 * - status
 * - thinking_delta
 * - text_delta
 * - done
 * - error
 */
app.post("/api/chat/stream", async (req, res) => {
  const { message, model } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      error: "Message is required and must be a non-empty string",
    });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const sendEvent = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  let clientClosed = false;
  let streamComplete = false;
  res.on("close", () => {
    clientClosed = true;
  });
  req.on("aborted", () => {
    clientClosed = true;
  });

  try {
    const opencodeSessionId = await ensureSession();
    const modelToUse = model || activeModel;
    const modelObject = await resolveModelObject(modelToUse);

    const localSession = sessions.get(activeSessionId);
    if (!localSession) {
      throw new Error("Active session missing");
    }

    sendEvent("session", {
      sessionId: activeSessionId,
      opencodeSessionId,
      model: modelToUse || "default",
    });
    sendEvent("status", { phase: "thinking", message: "OpenCode is thinking..." });

    const payload = buildMessagePayload(message, modelObject);
    const eventController = new AbortController();

    const eventRes = await fetch(`${OPENCODE_BASE_URL}/event`, {
      headers: { Accept: "text/event-stream", ...opencodeAuthHeader() },
      signal: eventController.signal,
    });

    if (!eventRes.ok || !eventRes.body) {
      throw new Error(`Unable to open OpenCode event stream (${eventRes.status})`);
    }

    const promptRes = await fetch(
      `${OPENCODE_BASE_URL}/session/${opencodeSessionId}/prompt_async`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", ...opencodeAuthHeader() },
        body: JSON.stringify(payload),
      }
    );

    if (!promptRes.ok) {
      const text = await promptRes.text().catch(() => "");
      throw new Error(`OpenCode prompt_async failed: ${promptRes.status} ${text}`);
    }

    const reader = eventRes.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let assistantMessageId = null;
    let assistantStarted = false;
    let sawTerminalFinish = false;
    let responseText = "";
    let sawAssistantOutput = false;
    const partTypeById = new Map();
    const partTextLenById = new Map();
    const partSawDelta = new Set();
    const deadline = Date.now() + 5 * 60 * 1000;

    while (!clientClosed && !streamComplete) {
      if (Date.now() > deadline) {
        throw new Error("Streaming timeout waiting for OpenCode response");
      }

      const { value, done } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() || "";

      for (const block of blocks) {
        const lines = block.split("\n");
        let dataRaw = "";

        for (const line of lines) {
          if (line.startsWith("data:")) {
            dataRaw += line.slice(5).trim();
          }
        }
        if (!dataRaw) continue;

        let busEvent;
        try {
          busEvent = JSON.parse(dataRaw);
        } catch {
          continue;
        }

        const type = busEvent.type;
        const props = busEvent.properties || {};
        if (props.sessionID !== opencodeSessionId) continue;

        if (type === "session.status") {
          const phase = props.status?.type || "busy";
          sendEvent("status", {
            phase,
            message: phase === "idle" ? "Done" : "Working...",
          });
          // End when session is idle and we have a terminal answer.
          if (phase === "idle" && (sawTerminalFinish || sawAssistantOutput)) {
            streamComplete = true;
            break;
          }
          continue;
        }

        if (type === "message.updated" && props.info?.role === "assistant") {
          assistantStarted = true;
          assistantMessageId = props.info.id;
          sendEvent("status", { phase: "responding", message: "OpenCode is writing..." });

          if (props.info?.finish && props.info.finish !== "tool-calls") {
            sawTerminalFinish = true;
            streamComplete = true;
            break;
          }

          if (props.info?.finish === "tool-calls") {
            sendEvent("status", { phase: "working", message: "Running tools..." });
          }
          continue;
        }

        if (type === "message.part.updated" && props.part?.id) {
          const part = props.part;
          partTypeById.set(part.id, part.type || "");

          if (part.type === "step-start") {
            const toolName =
              part.toolName ||
              part.tool?.name ||
              part.name ||
              part.title ||
              props.toolName ||
              props.tool?.name ||
              "";

            sendEvent("status", {
              phase: "working",
              message: toolName ? `Running tool: ${toolName}` : "Running tools...",
            });
          }

          if (
            assistantMessageId &&
            part.messageID === assistantMessageId &&
            typeof part.text === "string" &&
            !partSawDelta.has(part.id)
          ) {
            const prevLen = partTextLenById.get(part.id) || 0;
            const currLen = part.text.length;
            partTextLenById.set(part.id, currLen);

            if (currLen > prevLen) {
              const delta = part.text.slice(prevLen);
              if (part.type === "reasoning") {
                sendEvent("thinking_delta", { delta });
              }
              if (part.type === "text") {
                sawAssistantOutput = true;
                responseText += delta;
                sendEvent("text_delta", { delta, fullText: responseText });
              }
            }
          }
          continue;
        }

        if (type === "message.part.delta" && props.field === "text") {
          if (assistantMessageId && props.messageID !== assistantMessageId) continue;

          const delta = props.delta || "";
          if (!delta) continue;

          partSawDelta.add(props.partID);

          const partType = partTypeById.get(props.partID);
          if (partType === "reasoning") {
            sendEvent("thinking_delta", { delta });
            continue;
          }

          sawAssistantOutput = true;
          responseText += delta;
          sendEvent("text_delta", { delta, fullText: responseText });
          continue;
        }

        if (type === "session.idle" && (sawTerminalFinish || sawAssistantOutput)) {
          streamComplete = true;
          break;
        }
      }
    }

    eventController.abort();

    // Fallback: if no delta arrived, read latest assistant text once.
    if (!responseText) {
      const latest = await opencodeFetch(`/session/${opencodeSessionId}/message?limit=20`);
      for (let i = latest.length - 1; i >= 0; i -= 1) {
        const msg = latest[i];
        if (msg.info?.role === "assistant") {
          responseText = getTextFromMessageItem(msg);
          if (responseText) break;
        }
      }
    }

    localSession.messages.push(
      { role: "user", content: message.trim() },
      { role: "ai", content: responseText }
    );

    if (!clientClosed) {
      sendEvent("done", {
        response: responseText,
        sessionId: activeSessionId,
        opencodeSessionId,
        model: modelToUse || "default",
      });
      res.end();
    }
  } catch (err) {
    if (!clientClosed) {
      sendEvent("error", {
        error: "Failed to stream response from OpenCode",
        details: err.message,
      });
      res.end();
    }
  }
});

/**
 * POST /api/chat
 * Sends a message to OpenCode and returns the response.
 *
 * Body: { message: string, model?: string }
 * Response: { response: string, sessionId: string, model: string }
 *
 * The model field is optional. If provided, it overrides the active model
 * for this message only. OpenCode manages conversation context via session.
 */
app.post("/api/chat", async (req, res) => {
  const { message, model } = req.body;

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return res.status(400).json({
      error: "Message is required and must be a non-empty string",
    });
  }

  try {
    // Ensure we have an active session (this creates one if needed)
    const opencodeSessionId = await ensureSession();
    
    // Now get the local session (it should exist after ensureSession runs)
    let localSession = sessions.get(activeSessionId);
    
    // If still no session (shouldn't happen but just in case), create one
    if (!localSession) {
      localSession = {
        id: activeSessionId,
        title: "New Chat",
        opencodeId: opencodeSessionId,
        messages: [],
        createdAt: Date.now(),
      };
      sessions.set(activeSessionId, localSession);
    }

    // Determine which model to use
    const modelToUse = model || activeModel;
    const modelObject = await resolveModelObject(modelToUse);

    console.log(
      `[chat] Session: ${activeSessionId} | Model: ${modelToUse || "default"} | Message: ${message.substring(0, 80)}${message.length > 80 ? "..." : ""}`
    );

    // Send to OpenCode (with explicit model when it resolves successfully)
    const result = await opencodeFetch(
      `/session/${opencodeSessionId}/message`,
      {
        method: "POST",
        body: JSON.stringify(buildMessagePayload(message, modelObject)),
        directory: activeRootPath,
      }
    );

    // Extract the assistant's text response
    const responseText = extractTextFromParts(result.parts);

    // Update local session message history
    localSession.messages.push(
      { role: "user", content: message.trim() },
      { role: "ai", content: responseText }
    );

    console.log(`[chat] Response length: ${responseText.length} chars`);

    // Return response - note: model selection feature is UI-ready but uses default for now
    res.json({
      response: responseText,
      sessionId: activeSessionId,
      opencodeSessionId: opencodeSessionId,
      model: modelToUse || "default", // Return the requested model (or default)
    });
  } catch (err) {
    console.error("[chat] Error:", err.message);
    res.status(502).json({
      error: "Failed to get response from OpenCode",
      details: err.message,
    });
  }
});

/**
 * POST /api/clear
 * Clears the current session (deletes OpenCode session, resets local).
 */
app.post("/api/clear", async (_req, res) => {
  if (activeSessionId && sessions.has(activeSessionId)) {
    const session = sessions.get(activeSessionId);

    if (session.opencodeId) {
      try {
        await opencodeFetch(`/session/${session.opencodeId}`, {
          method: "DELETE",
        });
        console.log(`[clear] Deleted OpenCode session: ${session.opencodeId}`);
      } catch (err) {
        console.error("[clear] Error deleting session:", err.message);
      }
    }

    session.opencodeId = null;
    session.messages = [];
  }
  res.json({ success: true, message: "Session cleared" });
});

/**
 * GET /api/session
 * Returns the current active session info.
 */
app.get("/api/session", (_req, res) => {
  if (!activeSessionId || !sessions.has(activeSessionId)) {
    return res.json({ sessionId: null });
  }
  const s = sessions.get(activeSessionId);
  res.json({
    sessionId: activeSessionId,
    title: s.title,
    messageCount: s.messages.length,
    opencodeId: s.opencodeId,
  });
});

// ─── Start server ────────────────────────────────────────────────────────────

app.listen(BRIDGE_PORT, BRIDGE_HOST, () => {
  console.log(`
╔═══════════════════════════════════════════════════════════╗
║  OpenCode Bridge Server                                   ║
║  Listening on http://${BRIDGE_HOST}:${BRIDGE_PORT}        ║
║  OpenCode server:  ${OPENCODE_BASE_URL}       ║
║                                                           ║
║  Endpoints:                                               ║
║    GET  /api/health        — check connectivity           ║
║    GET  /api/models        — list available models        ║
║    POST /api/model         — set active model             ║
║    POST /api/chat          — send a message               ║
║    POST /api/chat/stream   — stream message realtime      ║
║    GET  /api/sessions      — list all sessions            ║
║    POST /api/sessions      — create new session           ║
║    POST /api/sessions/:id/activate — switch session       ║
║    DELETE /api/sessions/:id — delete session              ║
║    PATCH /api/sessions/:id  — rename session              ║
║    POST /api/clear         — reset current conversation   ║
║    GET  /api/session       — current session info         ║
╚═══════════════════════════════════════════════════════════╝
  `);

  console.log(
    BRIDGE_TOKEN
      ? "  Auth: BRIDGE_TOKEN is set — /api requires a bearer token."
      : "  Auth: BRIDGE_TOKEN is NOT set — /api is open to anyone who can reach it."
  );
  console.log(
    OPENCODE_PASSWORD
      ? "  OpenCode: password set — calls carry HTTP Basic.\n"
      : "  OpenCode: NO password. On shared hosting a neighbour may reach port 4097.\n"
  );

  if (BRIDGE_HOST === "0.0.0.0" && !BRIDGE_TOKEN) {
    console.warn(
      "\n  WARNING: bound to 0.0.0.0 with no authentication.\n" +
      "  Anyone who can reach this port can run an agent with filesystem\n" +
      "  access as this user. Use BRIDGE_HOST=127.0.0.1 unless this machine\n" +
      "  is firewalled.\n"
    );
  }
});
