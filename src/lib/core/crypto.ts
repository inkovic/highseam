/**
 * Auth primitives built ONLY on Web Crypto (globalThis.crypto), so the exact
 * same code runs in Node >= 18 and on Cloudflare Workers. No bcrypt, no
 * jsonwebtoken, no Node 'crypto' import.
 */

const enc = new TextEncoder();

// --- base64url helpers ------------------------------------------------------

function bytesToB64url(bytes: Uint8Array): string {
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array {
	const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
	const bin = atob(b64);
	const bytes = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
	return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
	return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBytes(hex: string): Uint8Array {
	const out = new Uint8Array(hex.length / 2);
	for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
	return out;
}

// --- password hashing (PBKDF2-SHA256) ----------------------------------------

const PBKDF2_ITERATIONS = 100_000;

export async function hashPassword(password: string): Promise<string> {
	const salt = crypto.getRandomValues(new Uint8Array(16));
	const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
	return `pbkdf2$${PBKDF2_ITERATIONS}$${bytesToHex(salt)}$${bytesToHex(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
	const parts = stored.split('$');
	if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
	const iterations = parseInt(parts[1], 10);
	const salt = hexToBytes(parts[2]);
	const expected = parts[3];
	const hash = await pbkdf2(password, salt, iterations);
	return timingSafeEqualHex(bytesToHex(hash), expected);
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
	const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, [
		'deriveBits'
	]);
	const bits = await crypto.subtle.deriveBits(
		{ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations },
		key,
		256
	);
	return new Uint8Array(bits);
}

function timingSafeEqualHex(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

// --- JWT (HS256) --------------------------------------------------------------

export interface JWTPayload {
	sub: string; // user id
	col: string; // auth collection slug
	exp: number; // unix seconds
	[key: string]: unknown;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
	return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, [
		'sign',
		'verify'
	]);
}

export async function signJWT(
	payload: Omit<JWTPayload, 'exp'>,
	secret: string,
	expiresInSeconds: number
): Promise<string> {
	const header = bytesToB64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
	const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
	const body = bytesToB64url(enc.encode(JSON.stringify({ ...payload, exp })));
	const data = `${header}.${body}`;
	const key = await hmacKey(secret);
	const sig = await crypto.subtle.sign('HMAC', key, enc.encode(data));
	return `${data}.${bytesToB64url(new Uint8Array(sig))}`;
}

export async function verifyJWT(token: string, secret: string): Promise<JWTPayload | null> {
	const parts = token.split('.');
	if (parts.length !== 3) return null;
	const [header, body, sig] = parts;
	const key = await hmacKey(secret);
	const valid = await crypto.subtle.verify(
		'HMAC',
		key,
		b64urlToBytes(sig) as BufferSource,
		enc.encode(`${header}.${body}`)
	);
	if (!valid) return null;
	try {
		const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(body))) as JWTPayload;
		if (typeof payload.exp !== 'number' || payload.exp < Date.now() / 1000) return null;
		return payload;
	} catch {
		return null;
	}
}
