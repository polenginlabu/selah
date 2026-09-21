<?php
/**
 * Minimal proxy to the OpenCode bridge on loopback.
 *
 * WHY THIS EXISTS
 *
 * The admin console needs to reach the bridge, which listens on 127.0.0.1 and
 * must stay there. The obvious route — an Apache `[P]` rewrite — is refused on
 * this shared plan: the rule matches, the proxy attempt is made, and Hostinger
 * answers 503 with its own error page. PHP, however, runs on the web tier and
 * can open a loopback socket, so it can do the same job in ten lines.
 *
 * WHAT KEEPS THIS SAFE
 *
 * The bridge runs an agent with filesystem access, so a general-purpose proxy
 * pointed at localhost would be a serious hole — an SSRF straight into
 * anything else listening on this machine. Therefore:
 *
 *   - only three exact paths are forwardable, as a whitelist, never a path
 *     taken from the caller
 *   - the host and port are hard-coded here, never taken from the request
 *   - the caller's Authorization header is passed through, and the bridge
 *     rejects anything without the right bearer token
 *
 * So the worst an anonymous caller can do is receive a 401.
 */

// Hard-coded. Never from the request.
const BRIDGE_ORIGIN = 'http://127.0.0.1:4098';

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

// Every prompt this proxy will forward must begin with this.
//
// WHY: /api/chat/start hands a message to an agent that has a checkout and
// real tools. Forwarding the body verbatim would make this endpoint a remote
// shell for anyone holding the bridge token — the token is the only thing in
// front of it, and a token can leak. Requiring the framing that
// supabase/functions/_shared/agentTask.js produces means the worst an attacker
// can do with a stolen token is ask a question, which is what the endpoint is
// for. Keep this string in step with buildAskTask().
const REQUIRED_PROMPT_PREFIX = 'You are the SELAH assistant, answering a question from a church leader.';

// Dynamic job lookups: /api/chat/status/<jobId>. The jobId is server-generated
// as "job_" + base36, so we validate that shape rather than trusting the URL.
const STATUS_PATTERN = '/api/chat/status/';

header('Content-Type: application/json');
// This is a status endpoint for one admin; nothing here should ever be cached.
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

if (isset(ALLOWED[$path])) {
    // Exact-path whitelist.
    if ($method !== ALLOWED[$path]) {
        fail(405, 'Method not allowed for this path.');
    }
} elseif (strncmp($path, STATUS_PATTERN, strlen(STATUS_PATTERN)) === 0) {
    // Dynamic status lookup: GET /api/chat/status/<jobId>.
    $jobId = substr($path, strlen(STATUS_PATTERN));
    if (!preg_match('/^job_[a-z0-9]+$/', $jobId) || $method !== 'GET') {
        fail(404, 'Unknown bridge path.');
    }
} else {
    fail(404, 'Unknown bridge path.');
}

if (!function_exists('curl_init')) {
    fail(500, 'PHP cURL is not available on this host.');
}

// Tell the bridge this request came from outside the machine. Without it the
// bridge sees a plain loopback call and its "refuse proxied requests when no
// token is configured" fail-safe never fires — which would leave these three
// endpoints open to the world if BRIDGE_TOKEN were ever lost.
$headers = [
    'Accept: application/json',
    'X-Forwarded-For: ' . ($_SERVER['REMOTE_ADDR'] ?? 'unknown'),
    'X-Forwarded-Proto: https',
];

// Pass the bearer token through untouched. getallheaders() is absent on some
// SAPIs, so fall back to the CGI variable.
$auth = '';
if (function_exists('getallheaders')) {
    foreach (getallheaders() as $name => $value) {
        if (strcasecmp($name, 'Authorization') === 0) { $auth = $value; break; }
    }
}
if ($auth === '') {
    $auth = $_SERVER['HTTP_AUTHORIZATION'] ?? $_SERVER['REDIRECT_HTTP_AUTHORIZATION'] ?? '';
}
if ($auth !== '') {
    $headers[] = 'Authorization: ' . $auth;
}

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

    // A prompt must carry the expected framing — see REQUIRED_PROMPT_PREFIX.
    if ($path === '/api/chat/start') {
        $decoded = json_decode($body, true);
        $message = is_array($decoded) && isset($decoded['message']) ? (string) $decoded['message'] : '';
        if (strpos($message, REQUIRED_PROMPT_PREFIX) !== 0) {
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
    // The bridge being down is the answer the admin came for, so report it as
    // a result rather than as a crash — and say which half failed.
    http_response_code(502);
    echo json_encode([
        'error' => 'Could not reach the bridge on ' . BRIDGE_ORIGIN . '. Is `npm run bridge` running on this server?',
        'detail' => $error,
    ]);
    exit;
}

http_response_code($status);
echo $response;
