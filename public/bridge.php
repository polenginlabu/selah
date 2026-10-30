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
    // Bible reader "Explain": open to any signed-in reader, not just admins.
    // The bridge builds the prompt from { reference, translation } itself and
    // runs it with every tool denied, so this route cannot direct the agent.
    // Streamed straight through to the reader (see the Explain section below).
    '/api/explain/stream' => 'POST',
];

// Explain: per-reader limit on runs that miss the cache (cache hits are free).
const EXPLAIN_RATE_LIMIT  = 10;
const EXPLAIN_RATE_WINDOW = 3600;

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

// ─── Gates ──────────────────────────────────────────────────────────────────
//
// The ask routes (start + poll + session) touch the agent, so they require an
// admin. Explain needs only a signed-in reader. health/models/model are
// non-sensitive and stay public.
$isExplain  = ($path === '/api/explain/stream');
$isAskRoute = ($path === '/api/chat/start' || $path === '/api/sessions' || $isStatus);
if ($isAskRoute || $isExplain) {
    if ($bridgeToken === '') {
        fail(503, 'BRIDGE_TOKEN is not configured on this server.');
    }
}
if ($isAskRoute) {
    require_admin();
}
$userId = $isExplain ? require_user() : '';

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

/**
 * Confirms the caller is a signed-in user and returns their id. Supabase Auth
 * validates the JWT (/auth/v1/user); the answer is cached per token like the
 * admin check, so status polls do not each cost a round trip.
 */
function require_user(): string {
    $jwt = read_bearer();
    if ($jwt === '') {
        fail(401, 'Sign in first.');
    }

    $now = time();
    $cacheFile = sys_get_temp_dir() . '/selah_user_' . md5($jwt) . '.txt';
    $cached = @file_get_contents($cacheFile);
    if ($cached !== false) {
        [$at, $id] = explode('|', $cached, 2);
        if ((int) $at > $now - 900 && $id !== '') return $id;
    }

    [$status, $body] = supabase_request('GET', '/auth/v1/user', $jwt);
    $user = json_decode($body, true);
    $id = ($status === 200 && is_array($user) && isset($user['id'])) ? (string) $user['id'] : '';
    if ($id === '') {
        fail(401, 'Sign in first.');
    }
    @file_put_contents($cacheFile, $now . '|' . $id);
    return $id;
}

/** @return array{0:int,1:string} status and body; status 0 when unreachable. */
function supabase_request(string $method, string $path, string $bearer, ?string $body = null, array $extraHeaders = []): array {
    $ch = curl_init(SUPABASE_URL . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 3,
        CURLOPT_CONNECTTIMEOUT => 2,
        CURLOPT_CUSTOMREQUEST  => $method,
        CURLOPT_HTTPHEADER     => array_merge([
            'Authorization: Bearer ' . $bearer,
            'apikey: ' . SUPABASE_ANON_KEY,
            'Content-Type: application/json',
        ], $extraHeaders),
    ]);
    if ($body !== null) {
        curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    }
    $response = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);
    return [$status, $response === false ? '' : (string) $response];
}

/** A cached explanation for reference + translation, or null on a miss or any error. */
function explain_cache_get(string $reference, string $translation, string $jwt): ?array {
    $query = http_build_query([
        'select'      => 'content,model',
        'reference'   => 'eq.' . $reference,
        'translation' => 'eq.' . $translation,
        'limit'       => 1,
    ]);
    [$status, $body] = supabase_request('GET', '/rest/v1/verse_explanations?' . $query, $jwt);
    $rows = json_decode($body, true);
    if ($status !== 200 || !is_array($rows) || !isset($rows[0]['content'])) {
        return null;
    }
    return $rows[0];
}

/**
 * Saves a finished explanation. Written with the service-role key because
 * readers may only read the cache: a reader who could write it could replace
 * "John 3:16" for everyone. Without the key nothing is cached and Explain
 * still works, just uncached.
 */
function explain_cache_put(string $reference, string $translation, string $content, string $model): void {
    $serviceKey = (string) (getenv('SUPABASE_SERVICE_ROLE_KEY') ?: '');
    if ($serviceKey === '') {
        return;
    }
    supabase_request(
        'POST',
        '/rest/v1/verse_explanations?on_conflict=reference,translation',
        $serviceKey,
        json_encode(['reference' => $reference, 'translation' => $translation, 'content' => $content, 'model' => $model]),
        ['apikey: ' . $serviceKey, 'Prefer: resolution=ignore-duplicates,return=minimal']
    );
}

/**
 * Records one uncached Explain run for this reader and reports whether it is
 * allowed. A file per user under flock: this server is the only writer, so
 * Postgres would add a round trip without adding safety.
 */
function explain_rate_limit_hit(string $userId): bool {
    $file = sys_get_temp_dir() . '/selah_explain_rl_' . md5($userId) . '.txt';
    $fh = @fopen($file, 'c+');
    if ($fh === false) {
        return true;
    }
    flock($fh, LOCK_EX);
    $now = time();
    [$start, $count] = array_map('intval', explode('|', (string) stream_get_contents($fh) . '|0|0'));
    if ($start <= $now - EXPLAIN_RATE_WINDOW) {
        [$start, $count] = [$now, 0];
    }
    $allowed = $count < EXPLAIN_RATE_LIMIT;
    if ($allowed) {
        $count += 1;
    }
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, $start . '|' . $count);
    flock($fh, LOCK_UN);
    fclose($fh);
    return $allowed;
}

// ─── Explain: cache, rate limit, then stream the bridge straight through ────
//
// The reader gets newline-delimited JSON as the model writes it (see
// POST /api/explain/stream in the bridge). A cache hit is a single "done" line.
// The final "done" line carries the reference and translation the bridge
// validated, and only then is the answer cached.

if ($isExplain) {
    $raw = file_get_contents('php://input') ?: '';
    if (strlen($raw) > 2048) {
        fail(413, 'Request body too large.');
    }
    $input = json_decode($raw, true);
    $reference = is_array($input) && is_string($input['reference'] ?? null) ? trim($input['reference']) : '';
    $translation = is_array($input) && is_string($input['translation'] ?? null) ? trim($input['translation']) : '';
    if ($reference === '' || $translation === '' || strlen($reference) > 120 || strlen($translation) > 60) {
        fail(400, 'A verse reference and translation are required.');
    }

    $hit = explain_cache_get($reference, $translation, read_bearer());
    if ($hit !== null) {
        header('Content-Type: application/x-ndjson; charset=utf-8');
        echo json_encode([
            'type'   => 'done',
            'cached' => true,
            'text'   => (string) $hit['content'],
            'model'  => (string) ($hit['model'] ?? ''),
        ]) . "\n";
        exit;
    }
    if (!explain_rate_limit_hit($userId)) {
        fail(429, 'You have reached the explanation limit for now. Try again later.');
    }

    // Pass every chunk on as it arrives: no PHP output buffering, no gzip.
    set_time_limit(240);
    if (function_exists('apache_setenv')) {
        @apache_setenv('no-gzip', '1');
    }
    @ini_set('zlib.output_compression', '0');
    while (ob_get_level() > 0) {
        ob_end_flush();
    }

    $status = 0;
    $streamed = '';
    $headersSent = false;
    $ch = curl_init(BRIDGE_ORIGIN . $path);
    curl_setopt_array($ch, [
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => json_encode(['reference' => $reference, 'translation' => $translation]),
        CURLOPT_TIMEOUT        => 230,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER     => [
            'Accept: application/x-ndjson',
            'Content-Type: application/json',
            'Authorization: Bearer ' . $bridgeToken,
            'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'),
            'X-Forwarded-Proto: https',
        ],
        CURLOPT_WRITEFUNCTION  => function ($ch, string $chunk) use (&$streamed, &$headersSent, &$status): int {
            if (!$headersSent) {
                $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
                http_response_code($status ?: 502);
                header($status === 200 ? 'Content-Type: application/x-ndjson; charset=utf-8' : 'Content-Type: application/json');
                header('Cache-Control: no-store');
                header('X-Accel-Buffering: no');
                $headersSent = true;
            }
            $streamed .= $chunk;
            echo $chunk;
            flush();
            // A reader who closed the sheet stops the run (the bridge sees the
            // connection close and cancels the OpenCode session).
            return connection_aborted() ? 0 : strlen($chunk);
        },
    ]);
    curl_exec($ch);
    $error = curl_error($ch);
    curl_close($ch);

    if (!$headersSent) {
        fail(502, 'Could not reach the bridge on ' . BRIDGE_ORIGIN . ': ' . $error);
    }
    if ($status === 200) {
        $lines = preg_split('/\n/', trim($streamed));
        $last = json_decode((string) end($lines), true);
        if (is_array($last) && ($last['type'] ?? '') === 'done'
            && trim((string) ($last['text'] ?? '')) !== ''
            && is_string($last['reference'] ?? null) && is_string($last['translation'] ?? null)) {
            explain_cache_put($last['reference'], $last['translation'], (string) $last['text'], (string) ($last['model'] ?? ''));
        }
    }
    exit;
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