<?php
/**
 * Direct gateway to the OpenCode bridge on loopback.
 *
 * WHY DIRECT
 *
 * The admin "Ask the agent" chatbot used to reach this bridge by going
 * browser -> Supabase Edge Function -> bridge.php -> bridge. That worked, but
 * the Edge Function lives in a different region, and the path from it back to
 * this host proved flaky (requests intermittently hung for 20s+). The browser
 * and this file run on the SAME server, so going straight to bridge.php is
 * fast and reliable. There is no longer a Supabase hop in the ask path.
 *
 * WHAT KEEPS THIS SAFE
 *
 * The bridge runs an agent with filesystem access and has no user accounts, so
 * a general-purpose public proxy would be a remote shell. Three things gate it:
 *
 *   1. Only exact paths are forwardable, never a path taken from the caller.
 *   2. Ask routes require a signed-in Supabase ADMIN. The caller sends its own
 *      Supabase JWT; we verify it against is_admin() in the database before
 *      forwarding. An anonymous or non-admin caller gets 401/403.
 *   3. The bridge's BRIDGE_TOKEN is held HERE, server-side (from the
 *      environment), and injected when we forward. The browser never sees it.
 *
 * So the worst an anonymous caller can do is receive a 401.
 *
 * ENV (set on the host, e.g. in PHP-FPM or an .htaccess SetEnv):
 *   BRIDGE_TOKEN          the shared secret the bridge accepts.
 *                         If unset, ask routes are refused (fail closed).
 *
 * On shared hosting where the PHP environment cannot be changed, put the token
 * one directory above the deployed site in a file named
 * selah-bridge-config.php:
 *     <?php define('BRIDGE_TOKEN', 'the-same-value-as-on-the-bridge');
 * That file lives outside dist/ so the deploy's rsync --delete never removes it.
 */

// Hard-coded. Never from the request.
const BRIDGE_ORIGIN = 'http://127.0.0.1:4098';

// Supabase project this app authenticates against. The anon key is public (it
// ships in the frontend); the caller's own JWT is what authorizes them.
const SUPABASE_URL = 'https://icmjnqwffvlacakwtpjb.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljbWpucXdmZnZsYWNha3d0cGpiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY0OTQ1MDMsImV4cCI6MjEwMjA3MDUwM30._ogVa2WHsUQFhIIVd2MhgTino9A3VfvgmhuZSYK2D-0';

// The only paths that may be reached, and the method each accepts.
const ALLOWED = [
    '/api/health' => 'GET',
    '/api/models' => 'GET',
    '/api/model'  => 'POST',
    // Asking the agent runs through the bridge's job API: open a session,
    // start a job, poll its status.
    '/api/sessions'    => 'POST',
    '/api/chat/start'  => 'POST',
];

// Dynamic job lookups: /api/chat/status/<jobId>. The jobId is server-generated
// as "job_" + base36, so we validate that shape rather than trusting the URL.
const STATUS_PATTERN = '/api/chat/status/';

// Every prompt this proxy will forward must begin with one of these.
//
// WHY: /api/chat/start hands a message to an agent that has a checkout and
// real tools. Requiring the framing that the frontend produces means even an
// admin (or a prompt-injected agent) is limited to the tasks those builders
// create — an ask, or the consolidation report — not running arbitrary work.
// Keep these in step with the builders:
//   ASK_PREFIX             src/lib/askTask.js      -> buildAskTask()
//   CONSOLIDATION_PREFIX   src/lib/consolidationTask.js -> buildConsolidationTask()
const REQUIRED_PROMPT_PREFIXES = [
    'You are the SELAH assistant, answering a question from a church leader.',
    'You are the SELAH consolidation agent, producing the discipleship consolidation report.',
];

// Requests may come from the app's own origin (same-host, no CORS) or a local
// dev server (cross-origin, needs CORS). Echo the origin only when it is one
// of these, so the proxy never endorses an arbitrary site.
$allowedOrigins = [
    'https://selah.devocean.website',
    'http://localhost:5173',
    'http://localhost:4173',
    'http://127.0.0.1:5173',
];
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if (in_array($origin, $allowedOrigins, true)) {
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');
    header('Access-Control-Max-Age: 600');
}
if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
    http_response_code(204);
    exit;
}

header('Content-Type: application/json');
header('Cache-Control: no-store');

function fail(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

// PATH_INFO is the part after bridge.php, e.g. /api/health. Some setups do not
// populate it, so ?p= is accepted as a fallback.
$path = $_SERVER['PATH_INFO'] ?? ($_GET['p'] ?? '');
if ($path === '') {
    fail(404, 'Unknown bridge path.');
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';

$isStatus = false;
if (isset(ALLOWED[$path])) {
    if ($method !== ALLOWED[$path]) {
        fail(405, 'Method not allowed for this path.');
    }
} elseif (strncmp($path, STATUS_PATTERN, strlen(STATUS_PATTERN)) === 0) {
    $jobId = substr($path, strlen(STATUS_PATTERN));
    if (!preg_match('/^job_[a-z0-9]+$/', $jobId) || $method !== 'GET') {
        fail(404, 'Unknown bridge path.');
    }
    $isStatus = true;
} else {
    fail(404, 'Unknown bridge path.');
}

if (!function_exists('curl_init')) {
    fail(500, 'PHP cURL is not available on this host.');
}

$bridgeToken = (string) (getenv('BRIDGE_TOKEN') ?: '');
if ($bridgeToken === '') {
    // Shared-hosting fallback: a config file one level above the deployed site
    // (outside dist/, so rsync --delete never wipes it). See the header.
    $configFile = dirname(__DIR__) . '/selah-bridge-config.php';
    if (is_file($configFile)) {
        @include $configFile;
        if (defined('BRIDGE_TOKEN')) {
            $bridgeToken = (string) BRIDGE_TOKEN;
        }
    }
}

// ─── Admin gate ─────────────────────────────────────────────────────────────
//
// Only the ask routes (start + poll + session) touch the agent, so only they
// require an admin. health/models/model are non-sensitive and stay public.
$isAskRoute = ($path === '/api/chat/start' || $path === '/api/sessions' || $isStatus);
if ($isAskRoute) {
    if ($bridgeToken === '') {
        fail(503, 'BRIDGE_TOKEN is not configured on this server.');
    }
    require_admin();
}

function read_bearer(): string {
    $auth = '';
    if (function_exists('getallheaders')) {
        foreach (getallheaders() as $name => $value) {
            if (strcasecmp($name, 'Authorization') === 0) { $auth = $value; break; }
        }
    }
    if ($auth === '') {
        $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
    }
    return preg_match('/^Bearer\s+(\S+)/i', $auth, $m) ? $m[1] : '';
}

/**
 * Confirms the caller is a signed-in admin, by asking the database (is_admin)
 * with the caller's own Supabase JWT. PostgREST validates the JWT signature
 * before the function runs, so a forged token cannot reach the check.
 *
 * The result is cached briefly per token so the status poll loop (every 2s)
 * does not hammer Supabase; a single poll is then a fast local read.
 */
function require_admin(): void {
    $jwt = read_bearer();
    if ($jwt === '') {
        fail(401, 'Sign in first.');
    }

    $now = time();
    $cacheFile = sys_get_temp_dir() . '/selah_admin_' . md5($jwt) . '.txt';
    $cached = @file_get_contents($cacheFile);
    if ($cached !== false) {
        [$at, $ok] = explode('|', $cached, 2);
        // 15 minutes. Whether someone is an admin changes rarely; the route
        // from this host to Supabase is the unreliable part, so the fewer
        // times a request depends on it, the better.
        if ((int) $at > $now - 900) {
            if ($ok === '1') return;
            fail(403, 'Admins only.');
        }
    }

    $ch = curl_init(SUPABASE_URL . '/rest/v1/rpc/is_admin');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        // Deliberately short. A slow Supabase must not be able to hold a
        // request open for eight seconds — the caller gives up first and the
        // ask looks broken when nothing is actually wrong with the agent.
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => '{}',
        CURLOPT_HTTPHEADER     => [
            'Authorization: Bearer ' . $jwt,
            'apikey: ' . SUPABASE_ANON_KEY,
            'Content-Type: application/json',
        ],
    ]);
    $body  = trim((string) curl_exec($ch));
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $isAdmin = ($status === 200 && $body === 'true');
    @file_put_contents($cacheFile, $now . '|' . ($isAdmin ? '1' : '0'));

    if (!$isAdmin) {
        fail(403, 'Admins only.');
    }
}

// ─── Forward ────────────────────────────────────────────────────────────────

// Forward with OUR server-side token (never the caller's). The caller's JWT is
// used only for the admin gate above. X-Forwarded-* let the bridge know this
// came from off-machine, so its own "no token configured" fail-safe applies.
$headers = [
    'Accept: application/json',
    'Authorization: Bearer ' . $bridgeToken,
    'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'),
    'X-Forwarded-Proto: https',
];

$ch = curl_init(BRIDGE_ORIGIN . $path);
curl_setopt_array($ch, [
    CURLOPT_RETURNTRANSFER => true,
    CURLOPT_TIMEOUT        => 15,
    CURLOPT_CONNECTTIMEOUT => 5,
    CURLOPT_HTTPHEADER     => $headers,
]);

if ($method === 'POST') {
    $body = file_get_contents('php://input') ?: '';
    if (strlen($body) > 8192) {
        fail(413, 'Request body too large.');
    }

    // A prompt must carry the expected framing — see REQUIRED_PROMPT_PREFIXES.
    if ($path === '/api/chat/start') {
        $decoded = json_decode($body, true);
        $message = is_array($decoded) && isset($decoded['message']) ? (string) $decoded['message'] : '';
        $allowed = false;
        foreach (REQUIRED_PROMPT_PREFIXES as $prefix) {
            if (strpos($message, $prefix) === 0) { $allowed = true; break; }
        }
        if (!$allowed) {
            fail(403, 'This prompt is not one this proxy will forward.');
        }
    }
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $headers[] = 'Content-Type: application/json';
    curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
}

$response = curl_exec($ch);
$status   = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
$error    = curl_error($ch);
curl_close($ch);

if ($response === false || $status === 0) {
    http_response_code(502);
    echo json_encode([
        'error' => 'Could not reach the bridge on ' . BRIDGE_ORIGIN . '. Is `npm run bridge` running on this server?',
        'detail' => $error,
    ]);
    exit;
}

http_response_code($status);
echo $response;